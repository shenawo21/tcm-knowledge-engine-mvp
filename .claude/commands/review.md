# /review — 代码审查流程

对当前变更或指定文件执行完整的多维度审查。

## 执行步骤

### Step 1：收集上下文
```bash
git diff HEAD
git status
```

### Step 2：调用 code-quality-reviewer（必选）
使用 `code-quality-reviewer` subagent 审查：
- 正确性与边界条件
- 架构一致性（前端只通过 `src/lib/api.ts` 访问后端）
- TypeScript 类型安全（严禁 `any`/`ts-ignore`）
- 回归风险

### Step 3：条件调用 test-engineer
如果变更涉及以下任一情况，调用 `test-engineer`：
- Tauri IPC 命令（`invoke()`）的参数或返回类型
- `src/lib/types.ts` 中的接口定义
- `src-tauri/src/` 中的 Rust 命令
- `npm run build` 或 `cargo check` 结果异常

### Step 4：条件调用 security-reviewer
如果变更涉及以下任一情况，调用 `security-reviewer`：
- API Key 处理（`saveAiModelConfig`、`apiKey` 参数）
- 用户输入文本传递给 AI API
- SQLite 查询构建
- 环境变量读取
- Tauri 权限配置（`tauri.conf.json`）

### Step 5：条件调用 tcm-product-reviewer
如果变更涉及以下任一情况，调用 `tcm-product-reviewer`：
- `src/prompts/` 目录下的 Prompt 文件
- AI 结构化输出展示（`ReviewPage.tsx`、`KnowledgePage.tsx`）
- `AiResult` 类型或实体-关系结构
- 中西医对照映射逻辑

### Step 6：运行验证命令
```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## 输出格式

```
## Review 结论

**Verdict：** PASS / PASS_WITH_NOTES / BLOCKING

**阻断问题（必须修复）：**
- [ ] 问题描述（文件:行号）

**次要问题（建议修复）：**
- [ ] 问题描述

**Agent 审查摘要：**
- code-quality-reviewer：[结论]
- test-engineer：[结论 / 未调用]
- security-reviewer：[结论 / 未调用]
- tcm-product-reviewer：[结论 / 未调用]

**验证结果：**
- `npm run build`：✅ / ❌
- `cargo check`：✅ / ❌

**Next Action：**
[一句话说明下一步]
```
