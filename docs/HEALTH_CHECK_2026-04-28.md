# 项目健康检查报告

**检查日期：** 2026-04-28
**分支：** `main`（领先 `origin/main` 1 个 commit，工作区干净）

---

## 一、构建结果

| 命令 | 结果 | 细节 |
|---|---|---|
| `npm run build` | ✅ 通过 | 26 modules，204 KB JS（64 KB gzip），412ms |
| `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ 通过 | 编译完成，无 warning，19.2s |

**前端与 Rust 后端均可干净编译，无阻断问题。**

---

## 二、技术栈核实

| CLAUDE.md 描述 | 实际情况 | 一致性 |
|---|---|---|
| React 18 + TypeScript + Vite | `package.json`：react **19.2.5**，vite 8.0.10，typescript 6.0.3 | ⚠️ React 版本偏差 |
| Tauri 2 | `@tauri-apps/api: 2.10.1`，schema 指向 tauri v2 | ✅ |
| SQLite 通过 Rust 访问 | `rusqlite 0.31`，前端只有 `invoke()` | ✅ |
| lucide-react | `package.json` 确认 `1.11.0` | ✅ |
| OpenAI-compatible API | `reqwest` + `SYSTEM_PROMPT` + chat completions/responses 双模式 | ✅ |
| Vite + rolldown | vite 8.x（rolldown 为 vite 8 底层，无需单独声明） | ✅ |
| TypeScript strict | `tsc` 无报错，代码中无 `any`/`ts-ignore` | ✅ |

**偏差说明：** CLAUDE.md 写"React 18"，实际为 React **19.2.5**。不影响功能，但文档与现实不一致，在日后添加 React 19 新特性时可能造成混淆。

---

## 三、前端结构审查

### 架构符合规范

- `src/lib/api.ts` 是唯一 IPC 层，所有页面只通过它调用 `invoke()`，未发现任何页面绕过封装直接调用 `@tauri-apps/api`。
- `src/lib/types.ts` 集中定义所有接口类型。
- 页面组件（`src/pages/`）只负责展示与状态管理，业务逻辑在 `lib/` 层。
- 路由以 `useState<PageKey>` 实现（无 React Router），适合 MVP 阶段，结构清晰。

### 前端安全扫描结果

| 检查项 | 结果 |
|---|---|
| `dangerouslySetInnerHTML` | ✅ 未发现 |
| `innerHTML` | ✅ 未发现 |
| `eval()` | ✅ 未发现 |
| `any` / `@ts-ignore` / `@ts-nocheck` | ✅ 未发现 |
| 硬编码 API Key | ✅ 未发现（`sk-...` 仅作为 input placeholder 文本） |

### Console 输出

- `src/lib/aiProcessor.ts:7`：`console.warn('[DEV FALLBACK] mockProcessInput active...')`
- 开发降级路径标注，**不包含敏感信息**，可接受。

---

## 四、Rust 后端审查

### 4.1 API Key 安全隔离

这是本项目最关键的安全设计，**执行正确**：

```rust
// models.rs line 117-118
/// Internal row — NOT Serialize; api_key must never reach the frontend.
pub struct AiModelConfigRow {  // 无 #[derive(Serialize)]
```

`AiModelConfigRow`（含明文 `api_key`）故意不实现 `Serialize`，**无法被序列化到前端**。前端只能收到 `AiModelConfigView`，其中 `api_key` 已被 `mask_api_key()` 替换为 `"sk-****xxxx"` 形式。

### 4.2 IPC 命令输入校验

| 命令 | 校验内容 |
|---|---|
| `create_ingestion_task` | `input_text.trim().is_empty()` → 拒绝 |
| `save_ai_result` | `task_id` 和 `input_text` 均校验非空 |
| `save_ai_model_config` | 5 个字段均校验非空；`api_type` 枚举校验 |
| `set_active_ai_model` | `config_id` 非空校验 |
| `process_with_ai` | `input_text` 非空校验 |

**注意：** `input_text` 没有长度上限校验。超大输入（如粘贴整本书）会进入 AI 请求体。reqwest 已设 30s timeout 兜底，不会崩溃，但影响用户体验。

### 4.3 SQLite 查询安全

全部 `rusqlite` 查询使用参数化 `params![]`，**无 SQL 注入风险**。

唯一的字符串拼接（`CONFIG_SELECT` + `FROM ...`）使用编译期常量，非用户输入，不存在注入风险。

### 4.4 Mutex 锁使用

`process_with_ai` 和 `test_ai_model_connection` 两个异步命令均正确在 `await` 前释放 `MutexGuard`：

```rust
let config_opt = {
    let conn = state.db.lock().map_err(lock_err)?;
    repository::get_active_ai_model_full(&conn).map_err(db_err)?
    // MutexGuard dropped here
};
ai_processor::process(&trimmed, config_opt).await  // 此处无锁
```

**设计正确**，避免了跨 await 持锁导致的死锁风险。

### 4.5 AI Prompt 设计

`SYSTEM_PROMPT` 内嵌于 `ai_processor.rs`，包含：

- 明确的 JSON 结构约束（`return ONLY valid JSON`）
- confidence 值域约束（0.0–1.0）
- Review 级别定义（A/B/C）
- `strip_markdown()` 处理 AI 返回的 markdown 包裹

**已知缺口：** Prompt 未包含"若信息不足应返回低 confidence 而非捏造"的防幻觉指令，属于知识质量风险，不影响构建。

---

## 五、问题汇总

| 等级 | 问题 | 位置 |
|---|---|---|
| **Low** | CLAUDE.md 写"React 18"，实际为 React 19.2.5 | `CLAUDE.md` 技术栈表格 |
| **Low** | `input_text` 无最大长度限制，超大输入直接进入 AI 请求 | `commands.rs:100`，`create_ingestion_task` |
| **Low** | AI Prompt 无防幻觉指令（"信息不足时返回低 confidence 而非捏造"） | `ai_processor.rs:13–41` |
| **Info** | `src/prompts/` 下的 Markdown prompt 文件与 Rust 侧 `SYSTEM_PROMPT` 是否同步无机制保证 | `src/prompts/` vs `ai_processor.rs` |
| **Info** | Tauri CSP 为 `null`——已知风险，需在 Milestone 2 前补充 | `tauri.conf.json:21` |

**无 Critical 或 High 级别问题。**

---

## 六、健康状况总结

**整体健康状况：良好。**

| 维度 | 状态 |
|---|---|
| 构建（前端 + Rust） | ✅ 全部通过 |
| API Key 隔离 | ✅ 设计正确，经代码验证 |
| TypeScript 类型安全 | ✅ 无 `any`/`ts-ignore` |
| IPC 架构边界 | ✅ 前端不持有敏感数据 |
| SQL 注入防护 | ✅ 全参数化查询 |
| 异步锁安全 | ✅ 无跨 await 持锁 |
| XSS 防护 | ✅ 无 innerHTML/eval |

---

## 七、下一步建议

1. **更新 CLAUDE.md**：将"React 18"改为"React 19"，保持文档与实际一致（纯文档修改，无需构建验证）。
2. **加 `input_text` 长度保护**：在 `commands.rs` 的 `create_ingestion_task` 和 `process_with_ai` 中加最大字符数限制（建议 10,000 字符），返回友好错误信息。
3. **补充防幻觉 Prompt 指令**：在 `ai_processor.rs` 的 `SYSTEM_PROMPT` 中加入"若文本中无明确信息，请返回 confidence < 0.5 而非捏造内容"，提升知识入库质量。
