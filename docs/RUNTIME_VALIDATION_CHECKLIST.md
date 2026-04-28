# 阶段一真实运行验证清单

**日期：2026-04-28 | 预算上限：$12 | 当前已消耗：~$1.78**

---

## 前置条件

- [ ] `npm run tauri dev` 成功启动，无编译错误
- [ ] OpenRouter Key 已准备（不写入代码，仅填入 UI）

---

## 步骤 1：配置模型

在「模型设置」页面填写并保存：

| 字段 | 值 |
|------|----|
| Provider 名称 | OpenRouter |
| Base URL | `https://openrouter.ai/api/v1` |
| API Key | `<你的 OpenRouter Key>` |
| Model Name | `anthropic/claude-sonnet-4.6` |
| API Type | `chat_completions` |

- [ ] 点击「保存」，确认保存成功提示
- [ ] 点击「设为当前」，确认该配置显示为激活状态

---

## 步骤 2：测试连接

- [ ] 点击该配置的「测试连接」按钮
- [ ] 确认返回「连接成功」及延迟毫秒数
- [ ] 如失败：截图错误信息，检查 base_url 末尾是否多余 `/`，不要反复重试

---

## 步骤 3：第一次 AI 结构化

在「知识采集」页面粘贴以下测试文本（约 120 字）：

> 麻黄汤由麻黄、桂枝、杏仁、炙甘草组成，主治太阳伤寒表实证。症见恶寒发热、无汗而喘、头身疼痛、脉浮紧。方中麻黄发汗解表为君，桂枝助麻黄发汗为臣，杏仁降气平喘为佐，炙甘草调和诸药为使。

- [ ] 点击「AI 结构化」，等待结果返回
- [ ] 确认结果页出现实体列表（如：麻黄、桂枝、太阳伤寒等）
- [ ] 记录本次调用后「AI 用量统计」中：
  - totalCalls = ___
  - cacheHitCount = ___
  - totalCostUsd = ___

---

## 步骤 4：第二次用完全相同文本执行

- [ ] 不修改文本，再次点击「AI 结构化」
- [ ] 确认结果返回（应与第一次相同）
- [ ] 记录本次调用后「AI 用量统计」中：
  - totalCalls = ___ （预期：比第一次 +1）
  - cacheHitCount = ___ （预期：比第一次 +1）
  - totalCostUsd = ___ （预期：与第一次相同，cache hit 不产生费用）

---

## 步骤 5：核对 OpenRouter 用量

- [ ] 登录 OpenRouter 控制台，查看 Usage 页面
- [ ] 确认上述两次调用只产生了 **1 次**实际 API 请求（第二次为 cache hit）
- [ ] 如 OpenRouter 显示 2 次请求，说明 cache 未命中，截图记录，不要反复重试

---

## 步骤 6：验证截断警告（可选）

- [ ] 提交一段超长文本（复制同一段落 10 次，超过 5000 字）
- [ ] 如 AI 输出被截断（`finish_reason: length`），确认 ReviewPage 有可见警告
- [ ] 如无警告，记录为待实现项

---

## 已知限制（不阻断验收）

- totalCostUsd 为本地估算值，与 OpenRouter 实际计费可能有小幅偏差（约 ±5%）
- cacheHitCount 统计自应用首次启动后，不区分日期
- 旧版数据库第一次运行时会自动建表，无需手动迁移

---

## Git Checkpoint（验证通过后执行）

```bash
git add .
git commit -m "feat: add AI cost tracking and exact cache"
```

> 注：截至 2026-04-28，上述 commit 已由 CI 流程自动完成（`9d279b4`）。
> 若本地有后续文档变更，可单独提交：`git add docs/ && git commit -m "docs: stage2 validation checklist"`

---

## 失败处理原则

- 遇到错误：截图 → 记录 → 停止，不要反复重试消耗预算
- 不要在 shell 中直接读取 SQLite 文件验证（使用 UI 展示即可）
- 不要修改 Rust 代码来调试，优先看 Tauri 控制台日志
