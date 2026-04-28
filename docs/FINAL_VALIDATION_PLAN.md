# 最终验证执行计划

**版本：** V1.0 — 2026-04-28  
**配合：** docs/VALIDATION_CASES.md + docs/VALIDATION_RESULTS_TEMPLATE.md

---

## 目标

在不超出 $12 预算的前提下，验证 App 对 10 类中医文本的 AI 结构化能力，确认进入个人生产使用的基准线。

---

## 预算估算

| 阶段 | 用例数 | 估计成本 | 累计 |
|------|--------|----------|------|
| 最低验证（进生产） | 5 条 | ~$0.01–$0.03 | ~$0.03 |
| 完整验证（10 条） | 10 条 | ~$0.02–$0.06 | ~$0.06 |
| 缓存复验（每条各一次） | 10 次 | $0 | $0 |
| 安全余量 | — | — | **剩余 ~$6.7** |

> 精确成本以 App「AI 用量统计」中 `totalCostUsd` 增量为准。

---

## 执行原则

1. **每次只跑一条用例**，跑完立即记录结果。
2. **失败后不要反复重试**。遇到错误先截图，确认原因后再决定是否重跑。
3. **每跑一条，记录运行前后的 `totalCostUsd` 和 `cacheHitCount`**（从「模型设置」页「AI 用量统计」读取）。
4. **不要在热重载期间触发 AI 结构化**（`npm run tauri dev` 文件变更时）。
5. **不要在未确认 NO_PROXY 正确的情况下点击测试连接**（参考 LITELLM_LOCAL_SETUP.md 第三节）。

---

## 进入个人生产使用的门槛

满足以下条件即可开始日常使用，无需等待全部 10 条通过：

- [ ] CASE-01 ~ CASE-05 全部 `success=Y`
- [ ] CASE-01 ~ CASE-05 全部 `json_valid=Y`
- [ ] CASE-01 ~ CASE-05 全部 `cost_recorded=Y`
- [ ] 至少 1 条 `cache_tested=Y`（二次结构化命中缓存）
- [ ] `totalCostUsd` 增量 ≤ $0.05

---

## 执行步骤（每条用例）

```
第一步：确认 LiteLLM Local 已启动（或切换 OpenRouter 直连）
第二步：进入「模型设置」页，记录当前 totalCostUsd 和 cacheHitCount
第三步：进入「采集任务」页，粘贴对应 CASE 文本
第四步：点击「开始 AI 结构化」
第五步：等待结果（通常 5–15 秒）
第六步：确认结果面板出现 entities 列表，无红色错误
第七步：回到「模型设置」页，记录新的 totalCostUsd 和 cacheHitCount
第八步：在 VALIDATION_RESULTS_TEMPLATE.md 填写该行数据
```

---

## 缓存验证步骤（至少执行 1 次）

在任意一条成功用例上，不修改文本，再次点击「开始 AI 结构化」：

- 速度明显更快（通常 <1 秒）
- `cacheHitCount` +1
- `totalCostUsd` 不变
- LiteLLM 终端无新请求日志

记录在对应 case 的 `cache_tested` 字段。

---

## 10 条全部通过后再考虑

- 接入更便宜的模型（如 Claude Haiku）
- 配置 LiteLLM 模型路由（主模型 + fallback）
- 接入 Langfuse / Helicone 可观测性
- 批量结构化流程

> 在 5 条未通过前，不引入任何上述扩展，避免调试成本叠加。

---

## 失败处理决策树

```
AI 结构化失败
├── 红色错误：「AI 输出达到 max_tokens 限制」
│   → 文本超过 500 字？分段后重试。
│   → 文本正常长度？记录 finish_reason=length，暂跳过此条。
│
├── 红色错误：「connection refused」/ 「502」
│   → 检查 LiteLLM 是否仍在运行。
│   → 检查 NO_PROXY 是否设置（见 LITELLM_LOCAL_SETUP.md 第三节）。
│   → 不要反复点击，确认代理后再试一次。
│
├── 红色错误：「401 Unauthorized」
│   → 检查「模型设置」页 keyDiagnostic，确认 key 格式。
│   → 切回 OpenRouter 直连配置重试。
│
├── JSON 显示异常（空 / 字段缺失）
│   → 截图，记录 notes，暂跳过此条，继续下一条。
│
└── 一切正常但 cost_recorded=N
    → 回到「模型设置」页刷新页面，等待 usage 统计更新。
```

---

## 验证完成标志

| 阶段 | 完成标志 |
|------|----------|
| 最低生产就绪 | CASE-01~05 全通过，VALIDATION_RESULTS_TEMPLATE.md 前 5 行填完 |
| 完整验证完成 | CASE-01~10 全通过，汇总表填完 |
| 可扩展 | 完整验证完成 + totalCostUsd ≤ $0.20 |
