# /fix-build — 构建修复流程

定位并最小化修复构建或类型检查错误。

## 执行步骤

### Step 1：运行构建，捕获完整错误信息
```bash
npm run build 2>&1
cargo check --manifest-path src-tauri/Cargo.toml 2>&1
```

### Step 2：分析根因
对每个错误：
- 定位出错的文件和行号
- 识别根本原因（类型不匹配、缺失导入、API 不兼容、Rust 借用错误等）
- 确认修复范围（不扩散到无关代码）

### Step 3：制定修复方案（先确认，再修改）
输出修复计划，明确：
- 需要修改的文件列表
- 每处修改的具体内容
- 是否影响其他模块

**等待用户确认后再执行修改。**

### Step 4：执行最小化修复

**严格禁止以下掩盖手段：**
- 添加 `any` 类型以绕过类型检查
- 添加 `@ts-ignore` / `@ts-nocheck` 注释
- 关闭 ESLint 规则（`// eslint-disable`）
- 删除现有测试
- 将 Rust 错误降级为 `.unwrap()` 然后忽略
- 修改 `tsconfig.json` 降低严格性

**正确的修复方向：**
- 类型错误 → 修正类型定义或调用方式
- 缺失字段 → 补充类型定义并确认 Rust/前端一致
- 导入错误 → 修正路径或导出
- Rust 编译错误 → 修正借用、生命周期、trait 实现

### Step 5：修复后重新验证
```bash
npm run build 2>&1
cargo check --manifest-path src-tauri/Cargo.toml 2>&1
```

确认两项均无错误后，调用 `code-quality-reviewer` 对修改内容进行审查。

## 输出格式

```
## 构建修复报告

**初始错误：**
- [错误描述] — 文件:行号

**根因分析：**
[说明根本原因]

**修复内容：**
- `文件路径` — 修改说明

**修复后验证：**
- `npm run build`：✅ / ❌
- `cargo check`：✅ / ❌

**未使用任何掩盖手段确认：** ✅
```
