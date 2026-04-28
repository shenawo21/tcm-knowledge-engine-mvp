# /create-feature — 新功能开发流程

安全、受控地开发新功能，确保与现有架构一致。

## 执行步骤

### Step 1：阅读规范
阅读 `CLAUDE.md`，确认：
- 技术栈约束
- 前后端 IPC 规则
- 医学安全边界
- 禁止行为列表

### Step 2：探索现有代码（只读，不修改）
```bash
# 了解相关页面和组件
# 了解现有 IPC 接口
# 了解 types.ts 中的现有类型
```

重点阅读：
- `src/lib/types.ts`：现有类型定义
- `src/lib/api.ts`：现有 IPC 封装
- 相关页面组件（`src/pages/`）
- `src-tauri/src/` 中相关的 Rust 命令

### Step 3：制定实现计划
输出以下内容，**等待用户确认**：

```
## 实现计划：[功能名称]

**需要新增/修改的文件：**
- [ ] `文件路径` — 变更说明

**新增 TypeScript 类型（如有）：**
- 类型名称及结构

**新增 Tauri IPC 命令（如有）：**
- 命令名称、参数、返回类型

**涉及的安全/医学风险（如有）：**
- [说明]

**不会修改的文件：**
- [列出确认不会动到的核心文件]
```

**收到用户确认前，不编写任何代码。**

### Step 4：执行开发
按计划修改文件，每次修改后确认符合：
- TypeScript strict 无 `any`
- 新 IPC 参数与 Rust 签名一致
- 医学内容安全边界

### Step 5：运行验证
```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

### Step 6：执行 review 流程
按 `/review` 命令的标准，调用相应 agents：
- 必调：`code-quality-reviewer`
- 如涉及 API Key/SQLite：`security-reviewer`
- 如涉及中医知识/AI 输出：`tcm-product-reviewer`
- 如涉及 IPC 接口变更：`test-engineer`

## 输出格式（完成后）

```
## 功能完成报告：[功能名称]

**新增/修改文件：**
- `文件路径` — 变更说明

**验证结果：**
- `npm run build`：✅ / ❌
- `cargo check`：✅ / ❌

**Agent 审查结论：**
- code-quality-reviewer：[结论]
- [其他 agent]：[结论]

**未修改计划外的业务代码确认：** ✅

**下一步建议：**
[1-2 句话]
```
