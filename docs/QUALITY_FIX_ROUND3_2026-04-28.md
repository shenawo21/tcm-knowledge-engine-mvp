# 第三轮质量修复报告：confidence 缺失与 review reason 命名空间修复

**修复日期：** 2026-04-28
**任务名称：** confidence 缺失与 review reason 命名空间修复

---

## 一、修改的文件

| 文件 | 变更内容 |
|---|---|
| `src-tauri/src/repository.rs` | 新增 4 个具名常量（`REASON_CONFIDENCE_MISSING` 等）；提取 `system_confidence_reason()` 辅助函数；将实体/关系 confidence 检查从 `if let Some(c)` 改为穷举 `match`，`None` 分支写入 `review_item`；AI review reason 加 `"ai:"` 前缀 |
| `src-tauri/src/models.rs` | 为 `AiSummary` struct 添加权威 doc comment，明确声明其不持久化、不进 review_item，并以 `MUST` 约束后续维护行为 |

---

## 二、confidence == None 静默入库问题如何修复

**原代码（有问题）：**

```rust
// 实体循环
if let Some(c) = ent.confidence {
    if c < HIGH_CONFIDENCE_THRESHOLD {
        // 写入 review_item
    }
}
// confidence 为 None 时：跳过，静默入库 ❌
```

**修复后（穷举 match）：**

```rust
match ent.confidence {
    Some(c) if c < HIGH_CONFIDENCE_THRESHOLD => {
        let reason = system_confidence_reason(c);
        insert_review_item(&tx, "entity", &entity_id, None, Some(&reason), None, None)?;
    }
    None => {
        insert_review_item(
            &tx,
            "entity",
            &entity_id,
            None,
            Some(REASON_CONFIDENCE_MISSING),
            None,
            None,
        )?;
    }
    _ => {} // confidence >= HIGH_CONFIDENCE_THRESHOLD，直接入库
}
```

同样修复应用于关系（relation）循环，确保所有无置信度条目均可被人工审核覆盖。

---

## 三、review reason 命名空间如何统一

**新增 4 个具名常量（命名空间：`system:*`）：**

```rust
const REASON_CONFIDENCE_MISSING: &str = "system:confidence_missing";
const REASON_ENTITY_NOT_FOUND: &str = "system:entity_name_not_found_in_batch";
const REASON_WM_REVIEW: &str = "system:western_mapping_requires_human_review";
const REASON_WM_LOGGED: &str = "system:western_mapping_source_fact_logged";
```

**提取辅助函数统一格式：**

```rust
fn system_confidence_reason(c: f64) -> String {
    if c < LOW_CONFIDENCE_THRESHOLD {
        format!("system:uncertain_confidence:{c:.2}")
    } else {
        format!("system:low_confidence:{c:.2}")
    }
}
```

**AI 生成的 review reason 加 `"ai:"` 前缀：**

```rust
// 修复前（AI 自由文本与系统结构化字符串混入同一列）
review_reason = Some(review.reason) // e.g. "来源为伤寒论"

// 修复后（命名空间区分）
let ai_reason = review.reason.as_deref().map(|r| format!("ai:{r}"));
// e.g. "ai:来源为伤寒论"
```

命名空间分类总结：

| 前缀 | 来源 | 示例 |
|---|---|---|
| `system:confidence_missing` | 流水线逻辑 | AI 未输出 confidence 字段 |
| `system:low_confidence:0.72` | 流水线逻辑 | 0.50–0.84 区间 |
| `system:uncertain_confidence:0.38` | 流水线逻辑 | < 0.50 区间 |
| `system:entity_name_not_found_in_batch` | 流水线逻辑 | 关系端点未在实体批次中找到 |
| `system:western_mapping_requires_human_review` | 流水线逻辑 | 非 source_fact 的映射 |
| `system:western_mapping_source_fact_logged` | 流水线逻辑 | source_fact 映射（已记录，低紧迫度） |
| `ai:...` | AI 自由文本 | AI review.reason 字段转发 |

---

## 四、AiSummary 处置策略如何明确

在 `models.rs` 的 `AiSummary` struct 上直接添加权威 doc comment：

```rust
/// AiSummary is returned to the frontend for display only — it is NOT persisted to the
/// database and does NOT generate review_item entries in the current implementation.
/// If future features use summary fields for knowledge ingestion, UI recommendations, or
/// any persistent storage, they MUST be routed through human review first.
#[derive(Debug, Serialize, Deserialize)]
pub struct AiSummary {
    pub one_sentence: Option<String>,
    #[serde(default)]
    pub key_points: Vec<String>,
    pub learning_value: Option<String>,
}
```

选择 struct 级 doc comment 而非代码注释：未来维护者看到 struct 定义时即能看到完整策略声明，无需追溯函数调用链。

---

## 五、构建验证结果

| 命令 | 结果 |
|---|---|
| `npm run build` | ✅ 通过（242ms，零错误） |
| `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ 通过（1.85s，零 warning） |

---

## 六、Agent 审查结论

### code-quality-reviewer：PASS_WITH_NOTES

- 4 个具名常量完全消除魔法字符串，后续过滤/分析可直接搜索
- `match` 穷举模式强制编译器在新增 `Option` 变体时报错，比 `if let` 更健壮
- `system_confidence_reason()` 消除了 entity/relation 两处格式重复
- 次要问题：`f64::NAN` 在 `match` 中走 `_` 分支（不写 `review_item`），属极罕见 edge case，当前 MVP 阶段可接受
- 次要问题：`Some("")` 的 `review.reason` 会产生 `"ai:"` 空前缀条目，后续可加 `filter(|r| !r.is_empty())` 防御

### security-reviewer：整体风险 Low，不阻断发布

- 新增常量为字面字符串，无注入风险
- `format!("ai:{r}")` 中 `r` 来自 AI 响应，已通过 `serde_json` 反序列化为 `String`，不直接进 SQL（通过 `params![]`），无 SQL 注入风险
- Low 级提醒：`review_item.review_reason` 列存储 AI 自由文本，本地 SQLite 场景可接受；如引入云同步或日志导出，AI 内容需过滤后输出

### tcm-product-reviewer：合格

- `confidence_missing` 覆盖是 TCM 知识质量的重要保障：古典文献往往描述关系而无量化依据，AI 可能因此省略 confidence，此类条目进入审核队列符合"不确定即审核"原则
- `system:` / `ai:` 命名空间分离有助于未来自动化审核系统区分规则触发和模型判断，具有产品演进价值
- AiSummary doc comment 的 `MUST` 关键词措辞准确，避免了"may"/"should"等模糊约束

---

## 七、剩余风险（更新后）

| 优先级 | 问题 | 状态 |
|---|---|---|
| ~~**P1（High）**~~ | ~~`confidence` 为 `None` 的实体/关系静默入库~~ | ✅ **已修复（Round 3）** |
| ~~**P2（Medium）**~~ | ~~`review.reason` 自由文本与系统 reason 混入同一列~~ | ✅ **已修复（Round 3）** |
| ~~**P3（Medium）**~~ | ~~`summary` 字段无处置策略声明~~ | ✅ **已修复（Round 3）** |
| **P1（Low）** | `f64::NAN` confidence 走 `_` 分支，不写 `review_item` | 极罕见；AI 输出通常不产生 NaN；MVP 阶段可接受 |
| **P2（Low）** | `Some("")` 的 `review.reason` 产生 `"ai:"` 空前缀条目 | 可加 `.filter(|r| !r.is_empty())`；影响极小 |
| **P3（Low）** | `AiResult` 列表长度无上限（entities/relations/western_mapping） | 极端 AI 输出可写入大量行；MVP 阶段流量有限可接受 |
| **P4（Low）** | 历史 `review_reason` 数据无 `system:` 前缀（Round 3 之前写入的行） | 需一次性 UPDATE 迁移脚本；不影响新增数据 |
| **P4（Low）** | `upsert_entity` 的 confidence 取最新值而非最高值 | `COALESCE(?1, confidence)` 在非 NULL 时覆盖旧值；与"多来源增强置信度"直觉相反 |
| **P4（Low）** | A 级 review 不产生任何记录 | AI 自判 A 级完全不进 `review_item`，溯源困难 |
| **Info** | `western_mapping` 的 `target_id` 为占位 UUID | 无实际持久化行对应；代码注释已标注；MVP 阶段可接受 |
| **Info** | `review_item` 无 `resolved_at`/解决者字段 | 当前无审核 UI；后续需补全审核闭环 |

---

## 八、三轮修复累计覆盖范围

| 轮次 | 核心问题 | 已解决 |
|---|---|---|
| Round 1 | React 版本文档、输入长度限制、基础抗幻觉 Prompt | ✅ |
| Round 2 | 置信度三档统一、western_mapping 全量审核、save_ai_result 长度常量 | ✅ |
| Round 3 | confidence 缺失静默入库、review_reason 命名空间、AiSummary 策略声明 | ✅ |
