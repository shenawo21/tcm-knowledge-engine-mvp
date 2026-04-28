# /security-check — 安全专项检查

对当前代码库执行全面安全扫描。**只汇报问题，不修改任何代码。**

## 执行步骤

### Step 1：API Key 扫描
```bash
# 搜索硬编码凭证模式
grep -r "sk-" src/ --include="*.ts" --include="*.tsx" -l
grep -r "Bearer " src/ --include="*.ts" --include="*.tsx" -l
grep -r "api_key\|apiKey\|API_KEY" src/ --include="*.ts" --include="*.tsx" -n
```

### Step 2：敏感数据流分析
检查以下路径中是否存在敏感数据泄露：
- `console.log` / `console.error` 是否输出用户输入或 API Key
- Tauri `invoke()` 返回值是否包含未脱敏的 `apiKey` 字段
- 错误信息是否包含系统路径、数据库路径

### Step 3：前端安全扫描
```bash
grep -r "dangerouslySetInnerHTML" src/ -n
grep -r "innerHTML" src/ -n
grep -r "eval(" src/ -n
```

### Step 4：Tauri 配置审查
读取 `src-tauri/tauri.conf.json`，检查：
- `security.csp` 配置
- 已允许的 Tauri 权限范围

### Step 5：调用 security-reviewer subagent
使用 `security-reviewer` 对上述扫描结果进行完整分析，并补充：
- SQLite 查询参数化检查
- Rust 侧输入校验检查
- 医学数据隐私合规检查

## 输出格式

```
## 安全检查报告

**扫描日期：** [日期]
**扫描范围：** 全量代码库

**Critical（必须立即修复）：**
- [ ] [问题描述] — 文件:行号

**High（发布前必须修复）：**
- [ ] [问题描述] — 文件:行号

**Medium（建议在下一迭代修复）：**
- [ ] [问题描述]

**Low / 已知风险（已接受）：**
- [ ] [问题描述 + 接受理由]

**整体结论：**
[是否存在阻断发布的安全问题]

**注意：本报告不包含任何代码修改。**
```
