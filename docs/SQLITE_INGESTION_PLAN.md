# SQLite 入库闭环 — 实现方案

> 目标：实现 `采集任务 → AI处理结果 → 写入数据库 → 知识库页面读取` 的最小闭环。
>
> 本文件为设计方案，不含代码。

---

## 1. 实现方案（分步骤）

整体原则：**SQLite 放在 Rust 端（Tauri）**，前端通过 `invoke` 调用命令。这符合 `ARCHITECTURE.md` 的"业务逻辑独立于客户端"原则，且为后续 Mac/移动端复用打基础。

### Step 1 — 后端基础设施
- 在 `Cargo.toml` 引入 `rusqlite`（`bundled` 特性，避免依赖系统 SQLite）、`uuid`、`chrono`、`serde`/`serde_json`（已有）。
- 新增 `db.rs`：连接管理、应用启动时执行 schema bootstrap。
- 新增 `models.rs`：与表对应的 serde 结构 + AI 输出的输入结构。
- 新增 `repository.rs`（或拆 `repo/` 目录）：每张表的纯增删改查。

### Step 2 — Schema bootstrap
- 把 `database/schema.sql` 改写为幂等（`CREATE TABLE IF NOT EXISTS …`），并通过 `include_str!` 内嵌到二进制中。
- 启动时（`tauri::Builder::setup`）打开 DB 文件，执行脚本，把 `Mutex<Connection>` 注入 Tauri State。
- DB 文件落在 `app_data_dir()`，**不要落在项目目录**。

### Step 3 — Tauri 命令层
新增一个 `commands.rs`，注册到 `invoke_handler`，至少含：
- `create_ingestion_task(input_text, task_type) -> task_id`
- `save_ai_result(task_id, ai_output)` —— 一次完整的写库事务
- `list_ingestion_tasks(limit, offset)` —— 给"采集任务"页历史列表
- `list_entities(filter)` —— 给"知识库"页表格
- `get_entity_detail(entity_id)` —— 给详情区

保留现有 `health_check`，不删。

### Step 4 — 写库事务（核心闭环点）
`save_ai_result` 内部：
1. 开事务。
2. 创建一条 `source` 行（无外部 URL 时也要造一条"用户输入"型 source，否则 entity/relation 没有出处可挂）。
3. 写入 `entity`，按 `(entity_type, name)` 去重：已存在则取已有 id，更新 `source_count`、`updated_at`；不存在则插入。
4. 写入 `relation`，把 AI 返回的实体名字解析为 entity_id；找不到的 relation 跳过 + 记入 `error_message` / 或写 `review_item`。
5. 低置信度（confidence < 阈值）写 `review_item`。
6. 更新 `ingestion_task.status = 'completed'`，错误则 `failed` + 写 `error_message`。
7. 提交事务。

### Step 5 — 前端 API 封装
- 新增 `src/lib/api.ts`：把 `invoke('create_ingestion_task', …)` 等封装成强类型函数。
- 新增 `src/lib/types.ts`：`Entity`、`Relation`、`IngestionTask`、`AIResult` 等类型，与 Rust 端 serde 结构对齐。

### Step 6 — 页面接线
- `IngestionPage`：点击"开始 AI 结构化"时 → `create_ingestion_task` → `mockProcessInput`（保留不动）→ `save_ai_result` → 显示原 JSON + 一行"已写入数据库（task=…）"。
- `KnowledgePage`：`useEffect` 中 `list_entities()`，替换硬编码的 `entities` 数组；详情区改成点击行后 `get_entity_detail`。
- `ReviewPage`、`GraphPage`、`Dashboard`：本期不接，**保持原样**，避免战线拉长。

### Step 7 — 自检 & 烟囱测试
- 启动 → 输入一段文本 → 跑一次 → 进知识库页看到桂枝汤 / 营卫不和 / 恶风 三个实体。
- 再跑一次同样输入 → 实体不重复，`source_count` 增加。
- 关掉 app 再开 → 数据还在。

---

## 2. 需要修改 / 新增的文件列表

### 新增（Rust 端）
- `src-tauri/src/db.rs` —— 连接 + schema bootstrap
- `src-tauri/src/models.rs` —— 数据结构（与 schema 对齐）
- `src-tauri/src/repository.rs` —— 表级 CRUD
- `src-tauri/src/commands.rs` —— `#[tauri::command]` 入口

### 修改（Rust 端）
- `src-tauri/Cargo.toml` —— 加 `rusqlite`、`uuid`、`chrono`
- `src-tauri/src/lib.rs` —— `setup` 初始化 DB、注册新命令、管理 State
- `database/schema.sql` —— 改成 `CREATE TABLE IF NOT EXISTS`（仅追加 `IF NOT EXISTS` 关键字，不改列）

### 新增（前端）
- `src/lib/api.ts` —— invoke 封装
- `src/lib/types.ts` —— 共享类型

### 修改（前端）
- `src/pages/IngestionPage.tsx` —— 串入库流程
- `src/pages/KnowledgePage.tsx` —— 改为从 DB 读

### 不动
- `App.tsx`、`Sidebar.tsx`、`Dashboard.tsx`、`GraphPage.tsx`、`ReviewPage.tsx`
- `aiProcessor.ts`（仍作为 mock，未来替换为真实 AI 调用时再改）
- `tauri.conf.json`、`vite.config.ts`、`tsconfig.json`、CSS

---

## 3. 数据流设计

```
用户输入文本（IngestionPage textarea）
        │
        ▼
invoke("create_ingestion_task", { input_text })
        │
        ▼
Rust: INSERT ingestion_task (status='pending')   ──► 返回 task_id
        │
        ▼
前端: mockProcessInput(input)  —— 仍然是本地 mock，输出 AIResult JSON
        │
        ▼
invoke("save_ai_result", { task_id, ai_output })
        │
        ▼
Rust 事务：
   ├─ INSERT source (synthetic, source_type='user_input')
   ├─ UPSERT entity[]  (按 entity_type+name 去重)
   ├─ INSERT relation[]  (name → entity_id 解析)
   ├─ INSERT review_item[]  (置信度低 / 等级 B/C)
   └─ UPDATE ingestion_task SET status='completed'
        │
        ▼
KnowledgePage useEffect → invoke("list_entities")
        │
        ▼
渲染表格（替代当前硬编码 entities）
```

关键边界：**前端只持有 task_id 和 AIResult，不直接拼 SQL**；Rust 端是唯一的写入者和真理来源。

---

## 4. 可能的风险点

1. **schema.sql 非幂等**：当前没有 `IF NOT EXISTS`，第二次启动会报 "table already exists"。必须改写或换成 migration runner。
2. **实体去重缺约束**：schema 没有 `UNIQUE(entity_type, name)`。如果只在应用层去重，并发或事务交叉时会写出重复实体。建议在 repository 层先用应用逻辑去重，**后续**再讨论是否加唯一索引（加索引会改 schema，影响别的表的 FK 行为，先不动）。
3. **relation 的实体名解析失败**：AI 返回的 `from`/`to` 是字符串名字，可能拼写差异、未抽取就被引用。需要明确策略：跳过 + 写 `review_item`，而不是静默丢弃。
4. **必须有 source 才能挂 relation/case**：mock AI 不产生 source。要由后端在 `save_ai_result` 时合成一条"用户输入型" source，否则 FK 不成立。
5. **事务回滚后 task 状态**：事务失败要把 `ingestion_task.status` 改成 `failed` 并写 `error_message`，**不要**把任务卡在 `pending`。
6. **DB 文件位置**：必须用 `app_data_dir`，否则不同启动方式（`tauri dev` vs 安装版）数据会分裂；项目目录里也不要落库（污染仓库）。
7. **rusqlite bundled 编译时间**：第一次构建会拉 SQLite 源码编译，Windows 上可能十几分钟。预期管理。
8. **JSON 字段约定**：`entity.aliases`、`flashcard.related_entity_ids` 是 TEXT，schema 没规定格式。统一用 `JSON 数组字符串`，写一个内部 helper，避免各处自由发挥。
9. **置信度阈值是隐性魔法数**：B/C 等级、低置信度阈值这些规则散落在 mock 里，进入入库阶段后要集中到 Rust 一处常量，避免前后端各拍一套。
10. **前后端类型漂移**：`AIResult` 形状目前由 `aiProcessor.ts` 自由定义，没有 TS 类型。直接把 `any` 喂给 Rust serde 会很容易在字段改名时静默坏掉。`save_ai_result` 在反序列化失败时必须有清晰错误。
11. **KnowledgePage 没有刷新机制**：写入后切到知识库页，如果只在组件挂载时拉一次，HMR 期间可能看不到新数据。先用每次进入页面就 re-fetch 兜底，不引入全局状态库。
12. **空输入 / 重复输入**：要在 `create_ingestion_task` 里拦截空字符串，不要造垃圾任务。

---

## 5. 哪些地方需要避免破坏现有结构

- **`App.tsx` 的 `PageKey` 联合类型和路由分发**：5 个页面的挂载方式不要动，新功能只往 page 内部加。
- **`Sidebar` 组件 props 接口**：保持 `{ active, onChange }`，不顺手加导航项或重命名 key。
- **`mockProcessInput` 的输出形状**：保留，作为合同。`aiProcessor.ts` 后续会被真实 AI 取代，**但本期不动**——只在它外面包流程。
- **`schema.sql` 的列名和列顺序**：所有 SQL 引用都吃这套命名，只允许追加 `IF NOT EXISTS`，不要改列、不加 `NOT NULL`、不加 `UNIQUE`、不加 `CHECK`。
- **`health_check` 命令**：保留，不要为了"清理"而删，它是排查 IPC 的烟囱。
- **`tauri.conf.json`**：本期不需要新插件、不改 CSP、不改窗口配置。
- **业务逻辑分层**：禁止把 SQL 或 schema 知识塞到 React 端（不要引 `sql.js` / `better-sqlite3` 之类）。所有写库走 Rust 命令，前端只持有类型和 invoke 封装。
- **未接入的页面（Dashboard / Graph / Review）**：不要趁机改它们的 mock 数据来"配合"知识库的真实数据，容易混淆真假来源，留到下个 milestone 再处理。
- **包管理**：`package.json` 现在用 `latest` 钉版本本身有风险，本期**不顺手**升级或重锁版本，只新增必要文件，不动 `dependencies`。
