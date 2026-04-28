# 验证结果记录表

**版本：** V1.0 — 2026-04-28  
**配合：** docs/VALIDATION_CASES.md + docs/FINAL_VALIDATION_PLAN.md  
**填写说明：** 每跑一条用例后立即填写，不要事后补填。

---

## 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `case_id` | 字符串 | CASE-01 ~ CASE-10 |
| `input_type` | 字符串 | 条文 / 方剂 / 医案 / 辨证 / 中西医映射 / 穴位 / 中药 / 长文本 |
| `model_config` | 字符串 | 例：LiteLLM Local / OpenRouter Direct |
| `run_date` | 日期 | YYYY-MM-DD |
| `success` | Y/N | AI 调用返回 HTTP 200 且无报错 |
| `json_valid` | Y/N | 返回 JSON 可正常解析，无 EOF / 截断错误 |
| `entities_ok` | Y/N | entities 列表非空，字段结构符合预期 |
| `relations_ok` | Y/N/NA | relations 列表存在且非空（无关系的用例填 NA） |
| `review_level_ok` | Y/N | AI 结构化结果含 review_level 或 confidence 字段 |
| `cost_recorded` | Y/N | ModelSettings 页「AI 用量统计」totalCalls 增加 |
| `cache_tested` | Y/N | 相同文本二次运行，cacheHitCount 增加（仅需在至少 1 条上验证） |
| `finish_reason` | 字符串 | stop / length / 未知（从错误提示或 App 日志读取） |
| `cost_delta_usd` | 数字 | 本条用例运行后 totalCostUsd 的增量（两次读数相减） |
| `notes` | 字符串 | 异常、截断提示、实体数、关系数、其他观察 |

---

## 结果表

| case_id | input_type | model_config | run_date | success | json_valid | entities_ok | relations_ok | review_level_ok | cost_recorded | cache_tested | finish_reason | cost_delta_usd | notes |
|---------|------------|--------------|----------|---------|------------|-------------|--------------|-----------------|---------------|--------------|---------------|----------------|-------|
| CASE-01 | 条文 | | | | | | | | | | | | |
| CASE-02 | 方剂 | | | | | | | | | | | | |
| CASE-03 | 医案 | | | | | | | | | | | | |
| CASE-04 | 辨证 | | | | | | | | | | | | |
| CASE-05 | 中西医映射 | | | | | | | | | | | | |
| CASE-06 | 穴位 | | | | | | | | | | | | |
| CASE-07 | 中药 | | | | | | | | | | | | |
| CASE-08 | 医案 | | | | | | | | | | | | |
| CASE-09 | 条文+方剂 | | | | | | | | | | | | |
| CASE-10 | 长文本 | | | | | | | | | | | | |

---

## 汇总

| 项目 | 值 |
|------|-----|
| 已运行用例数 | |
| 成功用例数 | |
| 失败用例数 | |
| 累计消耗 (totalCostUsd) | |
| 缓存命中次数 (cacheHitCount) | |
| 验证开始日期 | |
| 最后更新日期 | |

---

## 通过标准

- **进入个人生产使用：** CASE-01 ~ CASE-05 全部 success=Y，json_valid=Y，cost_recorded=Y，至少 1 条 cache_tested=Y
- **可考虑模型路由/便宜模型：** CASE-01 ~ CASE-10 全部通过
