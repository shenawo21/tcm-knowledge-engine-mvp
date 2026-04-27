# SQLite 入库闭环 — 最终验收报告

> 生成日期：2026-04-27
> 模型：Claude Sonnet 4.6 (1M context)
> 范围：本轮「SQLite 入库闭环」实施全程

---

## 1. 当前项目能否正常启动

**结论：前端可启动，Tauri 桌面端待人工验证。**

- `npm run dev`（纯 Vite 前端）：可启动，但 Tauri invoke 在浏览器环境下无后端，调用会静默失败或报 IPC 错误。
- `npm run tauri dev`（完整桌面端）：本轮未在 CI/会话中执行，需要本地 Rust 工具链 + Tauri CLI，首次冷启动会编译 rusqlite bundled（10–20 分钟）。代码层面无已知阻断问题。

---

## 2. npm run build 是否通过

**✅ 通过**

```
tsc && vite build
✓ 26 modules transformed.
dist/assets/index-Dzh41nT-.js   199.67 kB │ gzip: 63.26 kB
✓ built in 144ms
```

附注：构建过程中发现并修复了两个原项目预存在的阻断问题（与本轮功能无关）：
- 缺少 `@types/react` / `@types/react-dom`（strict 模式下 JSX 无类型声明）
- tsconfig.json 中 `moduleResolution=Node` 触发 TS 新版本弃用警告

---

## 3. cargo check 是否通过

**✅ 通过，3 个 warning（非 error）**

```
Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.34s
```

3 个 `dead_code` warning 均为 `AiSummary` / `AiWesternMapping` 字段在当前 mock 阶段未读取，属预期现象，等真实 AI 接入后自然消除。

---

## 4. npm run tauri dev 是否通过

**⚠️ 未执行 — 需要人工验证**

本会话无法操作桌面 GUI，未运行此命令。建议在本地执行：

```bash
npm run tauri dev
```

首次运行预计编译时间 10–20 分钟（rusqlite bundled 需编译 SQLite 源码）。

---

## 5. SQLite 入库闭环是否需要人工测试

**✅ 需要，建议执行以下验证步骤：**

1. 启动 `npm run tauri dev`，等待桌面窗口打开。
2. 进入「采集任务」页，输入任意中医文本，点击「开始 AI 结构化」。
3. 观察状态依次显示：`创建采集任务...` → `运行 AI 结构化...` → `写入数据库...` → `已写入数据库（task=…）`。
4. 切换到「知识库」页，确认表格显示实体（桂枝汤 / 营卫不和 / 恶风）。
5. 点击任意一行，确认详情区显示名称、类型、关系列表。
6. 重新运行同一段文本，确认实体不重复，`来源数` 从 1 变 2。
7. 关闭并重新打开应用，确认数据持久化。

---

## 6. 本轮修改文件列表

### 新增
| 文件 | 说明 |
|---|---|
| `src-tauri/src/db.rs` | SQLite 连接管理、schema bootstrap |
| `src-tauri/src/models.rs` | AI 输入结构 + DB 行模型（serde camelCase） |
| `src-tauri/src/repository.rs` | 表级 CRUD、`save_ai_result` 事务实现 |
| `src-tauri/src/commands.rs` | 6 个 `#[tauri::command]` |
| `src/lib/api.ts` | invoke 强类型封装 |
| `src/lib/types.ts` | TS 类型（与 Rust serde 对齐） |
| `src/vite-env.d.ts` | Vite 客户端类型声明 |
| `docs/SQLITE_INGESTION_PLAN.md` | 实施方案文档 |
| `docs/SQLITE_INGESTION_REPORT.md` | 本轮实施报告文档 |

### 修改
| 文件 | 改动内容 |
|---|---|
| `src-tauri/Cargo.toml` | 加 `rusqlite(bundled)` / `uuid` / `chrono` |
| `src-tauri/src/lib.rs` | setup 初始化 DB、注册命令、管理 State |
| `database/schema.sql` | 每个 `CREATE TABLE` 改为 `CREATE TABLE IF NOT EXISTS` |
| `src/pages/IngestionPage.tsx` | 串入库流程，3 步状态机 |
| `src/pages/KnowledgePage.tsx` | 从 DB 读取列表 + 行点击详情 |
| `tsconfig.json` | 加 `ignoreDeprecations: "6.0"` |
| `package.json` | 加 `@types/react` / `@types/react-dom` devDeps |

### 未动
`Dashboard.tsx` / `GraphPage.tsx` / `ReviewPage.tsx` / `aiProcessor.ts` /
`Sidebar.tsx` / `App.tsx` / `tauri.conf.json` / `vite.config.ts` / `main.tsx` / `app.css`

---

## 7. 当前仍存在的技术债

| 编号 | 类型 | 描述 | 风险等级 |
|---|---|---|---|
| TD-1 | 架构 | `package.json` 所有依赖使用 `latest`，无锁版本，跨机器 / 跨时间安装结果不确定 | 高 |
| TD-2 | 数据完整性 | 实体去重只在应用层做，无 `UNIQUE(entity_type, name)` 数据库约束，并发写入理论上可产生重复行 | 中 |
| TD-3 | 功能缺失 | `description` / `tcm_explanation` / `western_explanation` 字段 mock AI 不填充，知识库详情区信息稀薄 | 中 |
| TD-4 | 安全性 | mock AI 的 `confidence` 阈值（0.85）和审核等级判定（B/C）硬编码在 Rust 常量里，无配置入口 | 低 |
| TD-5 | 可维护性 | `aiProcessor.ts` 返回值仍是 `any`（被 `as AiResult` 强转），真实 AI 接入前无类型校验 | 低 |
| TD-6 | 功能缺失 | `ReviewPage` / `Dashboard` / `GraphPage` 三个页面仍是全静态 mock，与数据库完全断开 | 低（MVP 已知） |
| TD-7 | 运维 | 无数据库 migration 机制，schema 未来变更需要手动处理历史数据库文件 | 低（MVP 已知） |
| TD-8 | 关系一致性 | `list_relations_for` 使用 `JOIN entity`，若未来加入删除实体功能，孤立关系会从查询结果中消失 | 低 |

---

## 8. 下一步建议开发任务

按优先级排序：

**P0 — 验证闭环（立即）**
- 人工执行 `npm run tauri dev`，完成第 5 节的 7 步验证，确认闭环真实可用。

**P1 — 接入真实 AI**
- 在 `aiProcessor.ts` 中替换 mock，接入 OpenAI API 或本地模型。
- 解决 TD-5：为 AI 返回值加运行时校验（zod 或手写 guard）。

**P2 — 补齐知识库内容**
- 扩展 `save_ai_result` 事务，将 `western_mapping` 写入 `entity.western_explanation`，将 `summary.one_sentence` 写入 `entity.description`，解决 TD-3。

**P3 — 接入 ReviewPage / Dashboard**
- `ReviewPage`：从 `review_item` 表读取待审核项，支持人工决策（approve / reject）并回写 `decision`。
- `Dashboard`：从 DB 统计今日新增实体数、关系数、待审核数，替换当前硬编码卡片。

**P4 — 工程健壮性**
- 锁定 `package.json` 依赖版本（`npm shrinkwrap` 或手动固定），解决 TD-1。
- 添加数据库 migration 框架（如 `refinery` crate），解决 TD-7。
- 为 `repository.rs` 核心逻辑补充 Rust 单元测试（使用 `:memory:` SQLite），解决 TD-2 的测试覆盖。

**P5 — 知识图谱接入**
- 在 `GraphPage` 接入 `list_entities` + `list_relations`，替换静态节点，使用 React Flow 或 Cytoscape.js 渲染真实图谱。
