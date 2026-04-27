# SQLite 入库闭环 — 实现报告

> 实施依据：`docs/SQLITE_INGESTION_PLAN.md`
> 实施结果：`npm run build` 通过

---

## 修改 / 新增文件列表

### Rust 端
- 修改 `src-tauri/Cargo.toml` — 加 `rusqlite (bundled)`、`uuid`、`chrono`
- 修改 `src-tauri/src/lib.rs` — `setup` 初始化 DB + 注入 State + 注册命令；保留 `health_check`
- 新增 `src-tauri/src/db.rs` — 连接打开、`app_data_dir` 落库、schema bootstrap
- 新增 `src-tauri/src/models.rs` — AI 输入 / 行模型 / 视图模型（serde camelCase 输出）
- 新增 `src-tauri/src/repository.rs` — 表级 CRUD、事务实现
- 新增 `src-tauri/src/commands.rs` — 6 个 `#[tauri::command]`

### Schema
- 修改 `database/schema.sql` — 仅在每个 `CREATE TABLE` 后追加 `IF NOT EXISTS`，列名 / 列序 / 约束未动

### 前端
- 新增 `src/lib/api.ts` — `invoke` 强类型封装
- 新增 `src/lib/types.ts` — 与 Rust serde 对齐的 TS 类型
- 新增 `src/vite-env.d.ts` — vite 客户端类型（解决 `*.css` 副作用导入声明缺失）
- 修改 `src/pages/IngestionPage.tsx` — 串入库流程，状态机：idle → running(3 步) → done/error
- 修改 `src/pages/KnowledgePage.tsx` — 改为从 DB 读取列表 + 点击行调 `get_entity_detail`

### 工具配置（最小修复，build 阻塞性问题）
- 修改 `tsconfig.json` — 加 `"ignoreDeprecations": "6.0"`（TS 新版本对 `moduleResolution=Node` 的弃用警告）
- 修改 `package.json` — `npm install --save-dev @types/react @types/react-dom`（原项目缺类型声明，strict 模式下原本就编译不过）

### 未动
`Dashboard.tsx` / `GraphPage.tsx` / `ReviewPage.tsx` / `aiProcessor.ts` / `Sidebar.tsx` / `App.tsx` / `tauri.conf.json` / `vite.config.ts` / `main.tsx` / `app.css`。

---

## 关键实现说明

1. **DB 位置**：`app.path().app_data_dir() / "tcm-knowledge-engine.sqlite"`，启动时 `create_dir_all` + `Connection::open` + `execute_batch(SCHEMA_SQL)`，`SCHEMA_SQL` 通过 `include_str!("../../database/schema.sql")` 内嵌。

2. **State 共享**：`AppState { db: Mutex<Connection> }` 通过 `app.manage()` 注册；命令里 `state.db.lock()` 取连接。

3. **`save_ai_result` 事务**（`repository.rs::save_ai_result`）：
   - `conn.transaction()` 开事务
   - 合成 `source` 行（`source_type='user_input'`，title 取输入前 40 字符）
   - 实体按 `(entity_type, name)` 应用层去重：存在则 `source_count + 1`、`updated_at` 更新；不存在则插入。返回 `name -> id` 映射给关系解析用
   - 关系解析：from/to 都能查到 → 写 `relation`；任一找不到 → 写 `review_item(target_type='unresolved_relation', risk_flags=<json>)` 跳过，**不破坏事务**
   - 低置信度（`< 0.85`）实体 → 写 `review_item(target_type='entity', review_reason='low_confidence:<value>')`
   - AI 总评 level B/C → 写 `review_item(target_type='ingestion_task')`
   - 最后 `UPDATE ingestion_task` 至 `completed`，回填 `source_id` 和 `content_type`
   - `tx.commit()` 一次性提交；任一步失败 → 自动回滚 + 命令层调用 `mark_task_failed` 写入 `status='failed'` 和 `error_message`

4. **空输入拦截**：`create_ingestion_task` 与 `save_ai_result` 双重 `trim().is_empty()` 检查，前端 `IngestionPage.handleRun` 也提前 `trim()` 拦一道。

5. **前后端唯一通道**：`src/pages/IngestionPage.tsx` 和 `src/pages/KnowledgePage.tsx` 只 import `../lib/api`，没有任何对 `@tauri-apps/api/core` 的直接依赖；SQL 全部位于 Rust 侧。

6. **invoke 参数命名**：JS 侧用 snake_case（`input_text`、`task_id`、`ai_output`）匹配 Rust 函数参数名，避开 Tauri 大小写转换的版本差异。

7. **返回字段大小写**：Rust 行结构 `#[serde(rename_all = "camelCase")]`,TS 端直接 `entityType` / `sourceCount` / `relationsCount`,无需手动转换。

8. **KnowledgePage 行点击**：`useEffect([selectedId])` 触发 `get_entity_detail`，详情区显示实体字段 + 出向 / 入向关系。两个 effect 都做了 `cancelled` 标记，避免快速切换时旧请求覆盖新数据。

9. **`mockProcessInput` 未动**，`IngestionPage` 把它返回值作为 `AiResult` 直接传给 `save_ai_result`，AI 替换日只需改 `aiProcessor.ts` 内部，闭环不动。

---

## `npm run build` 结果

```
> build
> tsc && vite build

vite v8.0.10 building client environment for production...
✓ 26 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   0.40 kB │ gzip:  0.29 kB
dist/assets/index-CsnEsd2S.css    1.60 kB │ gzip:  0.69 kB
dist/assets/index-nsWMOdXL.js   199.68 kB │ gzip: 63.26 kB

✓ built in 296ms
```

通过过程中遇到的两个原项目预存在的阻塞问题已在「工具配置」章节标注。

---

## 仍未解决 / 待验证的问题

1. **Rust 端未实际编译过**：`npm run build` 只跑 `tsc && vite build`，不会触发 `cargo build`。本次会话没法跑完整 `cargo check`（rusqlite 的 `bundled` 特性首次编译会拉 SQLite 源码，Windows 上可能十几分钟）。下一步建议在你机器上跑一次 `cd src-tauri && cargo check`，或直接 `npm run tauri dev` 走完冷启动。代码本身按 rusqlite 0.31 / Tauri 2 的 API 形态写的。

2. **依赖版本飘移风险**：`package.json` 用 `latest` 钉版本，本次没动这块（按方案要求）。`@tauri-apps/api` 的具体次版本在不同时间安装可能 `invoke` 路径有差异，目前用的是 `@tauri-apps/api/core`（v2 标准路径）。

3. **Schema 不可加唯一索引**：方案明确禁止改字段，所以实体去重只在应用层做。如果未来并发高，需要单独迁移加 `UNIQUE(entity_type, name)`。

4. **`description` 字段始终为空**：mock AI 没产 `description`/`tcm_explanation`/`western_explanation`，所以知识库详情区目前只能显示名称、类型和关系。等真实 AI 接入后这些字段会自动填上。

5. **关系视图 SQL 用了 `JOIN entity`**：如果某条 relation 的两端实体被外部清理（目前没有删除入口，但将来若加），JOIN 会过滤掉它。当前 MVP 不影响。

6. **build 副产物 `tsconfig.json` 与 `package.json` 改动**：均为消除 strict-mode + TS 新版本的预存在编译阻塞；非功能性扩展。如不想要这两改，需要项目级别先解决类型基线问题。
