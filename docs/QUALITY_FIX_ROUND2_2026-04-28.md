# 第二轮质量修复报告：AI 结构化结果入库审查门槛统一

**修复日期：** 2026-04-28
**任务名称：** AI 结构化结果入库审查门槛统一

---

## 一、修改的文件

| 文件 | 变更内容 |
|---|---|
| `src-tauri/src/commands.rs` | 提取 `MAX_INPUT_TEXT_CHARS = 10_000` 常量；为 `save_ai_result` 加 `input_text` 长度检查；将 `create_ingestion_task` 和 `process_with_ai` 中的魔法数字替换为常量 |
| `src-tauri/src/repository.rs` | 将 `CONFIDENCE_THRESHOLD` 拆为 `HIGH_CONFIDENCE_THRESHOLD=0.85` 和 `LOW_CONFIDENCE_THRESHOLD=0.5`，附常量注释；entity 审核 reason 细分为 `low_confidence` / `uncertain_confidence`；relation 低置信度也写入 `review_item`；所有 `western_mapping` 条目写入 `review_item` |
| `src-tauri/src/ai_processor.rs` | 更新 `SYSTEM_PROMPT`：confidence 三档说明对齐代码阈值（0.85/0.5）；`western_mapping` mapping_level 枚举从 `exact\|reasonable_inference\|speculative` 改为 `source_fact\|reasonable_inference\|hypothesis\|uncertain`；新增 western_mapping 专项防幻觉指令 |

---

## 二、如何统一 confidence 阈值

**代码侧：** `CONFIDENCE_THRESHOLD: f64 = 0.85` 拆为两个具名常量：

```
HIGH_CONFIDENCE_THRESHOLD = 0.85  → 高于此值：直接入库
LOW_CONFIDENCE_THRESHOLD  = 0.50  → 低于此值：标记 uncertain_confidence
介于两者之间               → 标记 low_confidence，进入 review_item
```

**Prompt 侧：** 明确声明三档语义，与代码完全对齐：

```
>= 0.85 = directly stated in source text
0.50–0.84 = reasonably inferred, will be flagged for human review
< 0.50 = uncertain, omit unless significant
```

原有 0.5–0.84 的灰色地带（绕过审核直接入库）已消除。

---

## 三、western_mapping 如何进入审核

所有 `western_mapping` 条目在 `save_ai_result` 的同一 transaction 内写入 `review_item`，无论 mapping_level：

- `mapping_level != "source_fact"` → `review_reason = "western_mapping_requires_human_review"`
- `mapping_level == "source_fact"` → `review_reason = "western_mapping_source_fact_logged"`

内容（tcm 名、western 名、mapping_level）以 JSON 序列化存入 `risk_flags` 列，供审核员使用。无需改 schema。

---

## 四、save_ai_result 长度限制如何实现

三处校验现在共享同一常量，消除了魔法数字：

```rust
const MAX_INPUT_TEXT_CHARS: usize = 10_000;

// create_ingestion_task、process_with_ai、save_ai_result 三处均为：
if trimmed.chars().count() > MAX_INPUT_TEXT_CHARS {
    return Err(format!("input_text exceeds {MAX_INPUT_TEXT_CHARS} characters").into());
}
```

---

## 五、构建验证结果

| 命令 | 结果 |
|---|---|
| `npm run build` | ✅ 通过（133ms，零错误） |
| `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ 通过（1.69s，零 warning） |

---

## 六、Agent 审查结论

### code-quality-reviewer：PASS_WITH_NOTES

- 所有变更逻辑正确，常量拆分无回归
- `relation` 使用 `insert_relation` 返回的真实 id，比之前更准确
- 次要问题：`western_mapping` 的 `target_id` 是占位 UUID（无对应持久化行），建议加注释说明，防止后续维护者误以为可溯源
- transaction 一致性：所有新增 `insert_review_item` 调用在同一 `tx` 内，任意步骤失败均触发整体回滚，事务安全

### security-reviewer：整体风险 Low，不阻断发布

- SQL 注入：**无**（`serde_json::json!` 转义 + `params![]` 参数化写入全程无字符串拼接入 SQL）
- `f64` 格式化注入：**无**（`:.2` 格式只产生数字）
- 错误消息：无敏感信息泄露（仅含常量值 10000）
- Low 级提醒：`risk_flags` 中 AI 摘要术语属于"派生数据"，本地应用场景可接受；未来引入云同步时需重新评估

### tcm-product-reviewer：整体合格，发现若干剩余风险

**Prompt 改进评估：**
- 三档置信度说明锚定清晰，`"will be flagged for human review"` 透明说明有双重作用，防过度生成和防置信度虚报
- `source_fact` 比 `exact` 更准确：中西医映射是"文本声称如此"的认识论陈述，而非本体论等价；`hypothesis` 比 `speculative` 更符合循证医学语境；`uncertain` 作为显性兜底填补了原有枚举的语义空白
- western_mapping 全量进 review 设计合理，`source_fact_logged` / `requires_human_review` 分级处理有助于审核队列优先级管理

---

## 七、剩余风险

| 优先级 | 问题 | 说明 |
|---|---|---|
| **P1（High）** | `confidence` 为 `None` 的实体/关系静默入库 | AI 未输出 confidence 字段时，代码 `if let Some(c)` 直接跳过审核，条目无标记进入知识图谱 |
| **P2（Medium）** | `review.reason` 自由文本与系统 reason 混入同一列 | AI 生成的 reason（如"来源为伤寒论"）和系统生成的 reason（如 `"low_confidence:0.72"`）存在同一 `review_item.review_reason` 列，无命名空间区分，影响自动化过滤 |
| **P3（Medium）** | `summary` 字段无处置策略声明 | `AiSummary` 不持久化、不审核；若后续 UI 展示 AI 摘要，内容处于质量控制盲区 |
| **P4（Low）** | `upsert_entity` 的 confidence 用最新值覆盖而非取较高值 | 同一实体从低质量来源二次入库后 confidence 被降低，与"多来源增强置信度"的直觉相反（`COALESCE(?1, confidence)` 在 confidence 非 NULL 时覆盖旧值） |
| **P4（Low）** | A 级 review 不产生任何记录 | AI 自判 A 级的条目完全不进 `review_item`，溯源困难；A 级判断权完全在 AI 手中，无二次验证 |
| **Info** | `western_mapping` 的 `target_id` 为占位 UUID | 无实际持久化行对应，已用代码注释标注，MVP 阶段可接受；后续需建立 `western_mapping` 独立表并使用真实 ID |

---

## 八、下一步建议

**P1 修复优先级最高，改动量极小：** 在 `repository.rs` 的实体和关系循环中，对 `confidence == None` 的条目补充插入一条 `reason = "confidence_missing"` 的 `review_item`，确保所有条目均可被人工审核覆盖。

```rust
// 示例：entity 循环中
if ent.confidence.is_none() {
    insert_review_item(&tx, "entity", &entity_id, None, Some("confidence_missing"), None, None)?;
}
```

**P2 建议：** 为 AI 生成的 review reason 加前缀 `"ai:"` 以区分系统生成的结构化 reason。

**P3 建议：** 在代码注释中明确 summary 不持久化是有意为之，防止后续维护者误认为遗漏。
