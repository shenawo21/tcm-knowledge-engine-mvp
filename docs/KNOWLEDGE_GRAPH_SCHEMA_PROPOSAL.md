# TCM 知识图谱 Schema 设计提案

**文件版本：** v0.1 草案
**设计日期：** 2026-04-28
**状态：** 待人工确认，未实施

---

## 一、设计上下文

### 1.1 现有 Schema 能力边界

当前 `database/schema.sql` 已有：

| 表 | 职责 | 限制 |
|---|---|---|
| `entity` | 统一存储所有 TCM 实体，`entity_type` 字段区分类型 | 无类型化字段（herb 的归经、formula 的组成无专用列）；`aliases` 为非结构化 TEXT |
| `relation` | 有向二元关系，`relation_type` 区分 | 无证据文本索引；`review_status` 仅在 relation 上有，entity 上没有 |
| `review_item` | 审核队列 | 无 `resolved_at`、无解决人、无 `review_status` 的完整状态机 |
| `case_record` | 医案 | 与 entity/relation 无外键关联，无法展开知识图谱路径 |
| `western_mapping` | 不存在独立表，仅序列化进 `review_item.risk_flags` | 无法查询、无法关联实体 |
| `source` | 原文来源 | 已有 `reliability_level`，但 `review_status` 缺失 |

### 1.2 设计目标

1. 使知识图谱从"扁平实体列表"升级为"可查询、可溯源、可审核的多跳关系网络"。
2. 实现审核闭环：所有 AI 生成内容必须经过人工审核后才能提升为"confirmed"状态。
3. 保留完整证据链：每个节点和关系均可追溯到原文。
4. 西医映射必须隔离审核，防止中西医概念混淆污染知识图谱。

---

## 二、核心实体设计

### 2.1 实体类型升级策略

当前 `entity` 表用 `entity_type` 区分类型（herb、formula、syndrome 等），保持此策略，但为高频使用的类型增加扩展表（Extension Table 模式），核心表不变。

```
entity (主表，保持现有结构)
  └── entity_extension (按 entity_type 存储类型专属字段)
```

### 2.2 各实体类型及其质量字段

以下定义每种实体的职责字段和质量字段。质量字段（带 * 标注）对所有实体一致。

---

#### Symptom — 症状

```sql
-- 主记录在 entity 表（entity_type = 'symptom'）
-- 扩展字段（entity_extension 表，key-value 或专用列）：
symptom_location   TEXT  -- 部位（头痛、腹痛）
symptom_character  TEXT  -- 性质（胀痛、刺痛、隐痛）
symptom_timing     TEXT  -- 时间规律（昼重夜轻）
```

**质量字段：**

| 字段 | 类型 | 说明 |
|---|---|---|
| `source_text` | TEXT | 提取该症状的原文段落 |
| `source_id` | TEXT FK | 关联 source 表 |
| `confidence` | REAL | AI 提取置信度（0–1） |
| `mapping_level` | TEXT | 暂不适用（症状不做中西映射），填 `NULL` |
| `review_status` | TEXT | `pending_review` / `approved` / `rejected` / `needs_revision` / `archived` |
| `review_reason` | TEXT | 进入审核队列的原因（`system:*` 或 `ai:*`） |
| `created_by` | TEXT | `ai` / `human` |
| `created_at` | TEXT | ISO-8601 |
| `updated_at` | TEXT | ISO-8601 |

---

#### Syndrome — 证候

```sql
syndrome_pattern      TEXT  -- 证型（气虚、血瘀、阴虚火旺）
syndrome_category     TEXT  -- 八纲属性（表/里/寒/热/虚/实/阴/阳）
syndrome_organs       TEXT  -- 涉及脏腑（JSON array: ["肝","脾"]）
tongue_description    TEXT  -- 舌象描述
pulse_description     TEXT  -- 脉象描述
```

证候是 TCM 核心抽象，具有高不确定性，**confidence < 0.85 必须进审核**。

---

#### Disease — 疾病（中医病名）

```sql
disease_category    TEXT  -- 内科/外科/妇科/儿科
icd_mapping         TEXT  -- 对应西医 ICD 编码（谨慎填写，须标注 mapping_level）
classical_reference TEXT  -- 首次出现的经典文献
```

---

#### Formula — 方剂

```sql
formula_source      TEXT  -- 来源方书（伤寒论、金匮要略）
formula_composition TEXT  -- 原文药物组成（原文字符串保留）
formula_preparation TEXT  -- 制法（汤、丸、散、膏）
formula_dosage_note TEXT  -- 剂量注记
indications_tcm     TEXT  -- 主治证候（文本描述）
contraindications   TEXT  -- 禁忌
```

方剂的 `formula_treats_syndrome` 关系可从 AI 提取，但**组成关系（formula_contains_herb）须从原文核实**，不接受纯 AI 推断。

---

#### Herb — 中药

```sql
herb_nature         TEXT  -- 药性（寒/热/温/凉/平）
herb_flavor         TEXT  -- 药味（酸/苦/甘/辛/咸，JSON array）
herb_meridians      TEXT  -- 归经（JSON array: ["肺","大肠"]）
herb_function       TEXT  -- 功效（原文）
herb_standard_name  TEXT  -- 药典标准名
herb_latin_name     TEXT  -- 拉丁学名
herb_toxic_level    TEXT  -- 毒性等级（无毒/小毒/有毒/大毒）
```

`herb_toxic_level` 非 NULL 时，**所有涉及该药材的关系自动标记 `review_status = pending_review`**，无论 confidence 多高。

---

#### TreatmentMethod — 治法

```sql
treatment_category  TEXT  -- 汗/吐/下/和/温/清/消/补
treatment_principle TEXT  -- 治则文本描述
applicable_syndromes TEXT -- 适用证候（文本，非外键，可多条）
```

---

#### Meridian — 经络

```sql
meridian_system     TEXT  -- 十二正经/奇经八脉/络脉
meridian_flow_path  TEXT  -- 循行路线描述
interior_exterior   TEXT  -- 表里关系（如太阳/少阴）
zang_fu_organ       TEXT  -- 对应脏腑
```

经络实体为 TCM 理论性概念，置信度通常高（经典文献直接陈述），但西医映射（如"太阳经对应膀胱经络"）**必须进 western_mapping 审核**。

---

#### Case — 医案

```sql
-- 主记录在 case_record 表（已存在），但需新增知识图谱关联字段
entity_id           TEXT FK  -- 关联 entity（可空，指向 Case 实体节点）
syndrome_ids        TEXT     -- 确诊证候 ID 列表（JSON array）
formula_ids         TEXT     -- 使用方剂 ID 列表（JSON array）
outcome_type        TEXT     -- 痊愈/好转/无效/加重
evidence_quality    TEXT     -- 证据等级（case_report/case_series/RCT/systematic_review）
```

医案属于**个人健康信息**，无论 confidence 多高，**patient_info 字段禁止进入知识图谱实体或关系，仅保留在 case_record 表的受控访问范围内**。

---

#### Source — 原文来源

Source 表已存在，补充以下字段：

```sql
review_status       TEXT  -- 来源可靠性的人工评估状态
evidence_level      TEXT  -- 证据等级（RCT/systematic_review/clinical_guideline/classical_text/expert_opinion）
peer_reviewed       INTEGER  -- 0/1
publication_type    TEXT  -- 原著/教材/医案集/论文/网络资料
```

---

#### Evidence — 证据节点

**新表**。当前设计中，证据以 `source_text` 字段内联存储在关系上，但无法跨关系复用同一段原文。引入独立 Evidence 节点：

```sql
CREATE TABLE IF NOT EXISTS evidence (
  id              TEXT PRIMARY KEY,  -- UUID
  source_id       TEXT NOT NULL,     -- FK → source
  chunk_id        TEXT,              -- FK → document_chunk（可空）
  raw_text        TEXT NOT NULL,     -- 原文段落（必须保留原文）
  page_ref        TEXT,              -- 页码/章节引用
  reliability     TEXT,              -- high/medium/low/uncertain
  created_at      TEXT,
  updated_at      TEXT,
  FOREIGN KEY (source_id) REFERENCES source (id)
);
```

Evidence 节点的核心意义：**一段原文可以同时支撑多个关系，避免原文重复存储，保持证据链的单一来源**。

---

#### Mechanism — 机制节点

**新表**。存储对中医关系的解释性描述（TCM 理论机制或现代医学机制假说）：

```sql
CREATE TABLE IF NOT EXISTS mechanism (
  id               TEXT PRIMARY KEY,
  mechanism_type   TEXT,  -- tcm_theory / biomedical_hypothesis / in_vitro / clinical_evidence
  description      TEXT NOT NULL,
  confidence       REAL,
  source_id        TEXT,  -- FK → source
  evidence_id      TEXT,  -- FK → evidence
  review_status    TEXT,
  review_reason    TEXT,
  created_by       TEXT,  -- ai / human
  created_at       TEXT,
  updated_at       TEXT,
  FOREIGN KEY (source_id)   REFERENCES source (id),
  FOREIGN KEY (evidence_id) REFERENCES evidence (id)
);
```

`mechanism_type = 'biomedical_hypothesis'` 的所有记录**默认 `review_status = pending_review`**，必须人工确认后方可显示在知识图谱中。

---

#### BiomedicalConcept — 西医概念

**新表**。将西医概念从 `entity` 表中分离，避免 TCM 实体与西医概念混用同一表的 `entity_type` 字段：

```sql
CREATE TABLE IF NOT EXISTS biomedical_concept (
  id               TEXT PRIMARY KEY,
  concept_type     TEXT,  -- disease / drug / gene / pathway / biomarker / symptom
  name             TEXT NOT NULL,
  icd_code         TEXT,
  mesh_term        TEXT,
  description      TEXT,
  confidence       REAL,
  source_id        TEXT,  -- FK → source
  review_status    TEXT,
  review_reason    TEXT,
  created_by       TEXT,
  created_at       TEXT,
  updated_at       TEXT,
  FOREIGN KEY (source_id) REFERENCES source (id)
);
```

---

#### WesternMapping — 中西医映射

**新表**（从 `review_item.risk_flags` 中升级为独立可查询表）：

```sql
CREATE TABLE IF NOT EXISTS western_mapping (
  id                TEXT PRIMARY KEY,
  tcm_entity_id     TEXT NOT NULL,  -- FK → entity
  biomedical_id     TEXT NOT NULL,  -- FK → biomedical_concept
  mapping_type      TEXT NOT NULL,  -- entity_to_concept / relation_to_mechanism / syndrome_to_disease
  mapping_level     TEXT NOT NULL,  -- source_fact / reasonable_inference / hypothesis / uncertain
  supporting_text   TEXT,           -- 原文依据
  evidence_id       TEXT,           -- FK → evidence
  source_id         TEXT,           -- FK → source
  confidence        REAL,
  review_status     TEXT NOT NULL DEFAULT 'pending_review',  -- 永远进审核
  review_reason     TEXT,
  reviewer_id       TEXT,           -- 人工审核者标识
  reviewed_at       TEXT,
  created_by        TEXT,           -- ai / human
  created_at        TEXT,
  updated_at        TEXT,
  FOREIGN KEY (tcm_entity_id)  REFERENCES entity (id),
  FOREIGN KEY (biomedical_id)  REFERENCES biomedical_concept (id),
  FOREIGN KEY (evidence_id)    REFERENCES evidence (id),
  FOREIGN KEY (source_id)      REFERENCES source (id)
);
```

WesternMapping 是本 Schema 中**唯一一个在 DEFAULT 层面强制 `pending_review` 的表**，详见第四节。

---

## 三、核心关系设计

所有关系均存储于 `relation` 表，`relation_type` 字段区分语义。以下为规范化的关系类型及其约束。

### 3.1 关系类型目录

| relation_type | from | to | 说明 |
|---|---|---|---|
| `syndrome_has_symptom` | Syndrome | Symptom | 证候包含症状 |
| `formula_treats_syndrome` | Formula | Syndrome | 方剂主治证候 |
| `formula_contains_herb` | Formula | Herb | 方剂组成药材 |
| `herb_enters_meridian` | Herb | Meridian | 药材归经 |
| `treatment_method_guides_formula` | TreatmentMethod | Formula | 治法指导方剂选择 |
| `case_demonstrates_syndrome` | Case | Syndrome | 医案体现证候 |
| `case_uses_formula` | Case | Formula | 医案使用方剂 |
| `source_supports_entity` | Source | Entity | 原文支撑实体存在 |
| `source_supports_relation` | Source | Relation（伪节点） | 原文支撑关系成立 |
| `mechanism_explains_relation` | Mechanism | Relation（伪节点） | 机制解释关系 |
| `tcm_concept_maps_to_biomedical` | Entity(TCM) | BiomedicalConcept | 中西医映射（经 WesternMapping 表实现） |
| `syndrome_differentiates_from` | Syndrome | Syndrome | 证候鉴别诊断 |
| `formula_modifies_formula` | Formula | Formula | 方剂加减化裁 |
| `herb_compatible_with` | Herb | Herb | 相须/相使配伍 |
| `herb_incompatible_with` | Herb | Herb | 相畏/相杀/相反/相恶 |

> `herb_incompatible_with` 关系中涉及毒性配伍（十八反、十九畏），**`review_status` 必须默认 `pending_review`**，且在审核 UI 中应有高优先级标记。

### 3.2 关系质量字段

每条 `relation` 记录的完整字段（扩展现有表）：

```sql
ALTER TABLE relation ADD COLUMN source_text   TEXT;   -- 支撑该关系的原文段落
ALTER TABLE relation ADD COLUMN evidence_id   TEXT;   -- FK → evidence（可空）
ALTER TABLE relation ADD COLUMN mapping_level TEXT;   -- 仅 tcm_concept_maps_to_biomedical 类型使用
ALTER TABLE relation ADD COLUMN review_reason TEXT;   -- system:* 或 ai:*
ALTER TABLE relation ADD COLUMN created_by    TEXT;   -- ai / human
ALTER TABLE relation ADD COLUMN updated_at    TEXT;   -- 补充（现无此字段）
```

> 注：以上为建议增量字段，待实施阶段以 migration 方式添加，不影响现有数据。

---

## 四、review_status 状态机设计

### 4.1 状态定义

| 状态 | 含义 | 可见于知识图谱 |
|---|---|---|
| `pending_review` | AI 生成，等待人工审核 | **否**（仅在审核队列可见） |
| `approved` | 人工确认，质量达标 | **是** |
| `rejected` | 人工拒绝，不纳入知识图谱 | **否** |
| `needs_revision` | 存在问题，需 AI 或人工修订后重新提交 | **否** |
| `archived` | 已被更优记录取代，保留溯源但不展示 | **否**（仅在归档视图可查） |

### 4.2 状态转移规则

```
[AI 生成]
    │
    ▼
pending_review  ──(人工审核通过)──▶  approved
    │                                    │
    │──(人工拒绝)──────────────────▶  rejected
    │
    │──(标记需修订)─────────────────▶  needs_revision
                                         │
                                (修订完成后重新提交)
                                         │
                                         ▼
                                   pending_review（重入队列）

approved ──(被更优记录取代)──────▶  archived
```

### 4.3 哪些 AI 结果可以暂存（仍为 pending_review）

以下条件满足时，AI 结果**可以安全写入 `pending_review` 状态**，暂存等待人工批量审核：

| 条件 | 说明 |
|---|---|
| `confidence >= 0.85` 且来源为经典原文（A 级 review） | 质量最高，审核可快速批量通过 |
| `confidence 0.50–0.84` | 中等置信度，需逐条审核 |
| 关系类型为 `formula_contains_herb`，来源为原文直接摘录 | 组成关系有原文依据 |
| `mechanism_type = 'tcm_theory'` | TCM 自身理论体系内的解释 |

### 4.4 哪些必须人工审核后方可进入图谱

以下情况**必须经 `approved` 状态方可在知识图谱中可见**：

| 情况 | 原因 |
|---|---|
| 所有 `western_mapping` 记录 | 中西医概念不等价，映射具有认识论风险 |
| `confidence = NULL` 的实体/关系 | 无置信度依据，无法评估可靠性 |
| `confidence < 0.50` 的实体/关系 | AI 自身判断为不确定 |
| 涉及有毒药材（`herb_toxic_level` 非 NULL）的关系 | 临床安全风险 |
| `herb_incompatible_with` 关系 | 配伍禁忌，错误会有临床危害 |
| `mechanism_type = 'biomedical_hypothesis'` 的机制节点 | AI 易过度推断生物医学机制 |
| `review.level = 'C'`（AI 自判低质量） | AI 主动标记不确定性 |
| 医案 `patient_info` 相关任何字段 | 个人健康信息隐私 |

### 4.5 为什么 western_mapping 必须默认审核

1. **认识论差异**：TCM 证候（如"肾阳虚"）与西医疾病（如慢性肾病）不是等价映射，而是不同理论框架下的描述，不能直接等号相连。
2. **AI 幻觉风险**：LLM 会生成看似合理但缺乏循证依据的中西医机制描述（如"黄芪通过调节 TGF-β 通路改善肾纤维化"——此类表述需有具体文献支撑，不可由 AI 凭关联词汇推断）。
3. **临床误导风险**：如果未经审核的西医映射被用户当作确定性知识，可能影响临床决策。
4. **法律责任**：作为医学教育工具，展示未经核实的中西医等价映射可能构成误导性医学信息。

### 4.6 A 级 review 是否应该记录

**应该记录，但策略上与 B/C 级不同。**

当前代码中 `review.level = 'A'` 的条目完全不进 `review_item`，存在以下问题：
- 无法知道有多少 A 级条目被 AI 直接入库。
- A 级判断权完全在 AI 手中，无二次验证机制。
- 无法对历史 A 级条目做抽样审计。

**建议策略：**

```
A 级 → review_status = pending_review（但优先级最低）
        review_reason = "system:ai_self_rated_A"
        decision = "direct_import"（AI 建议，非最终）
```

A 级条目在审核 UI 中以绿色标注，支持批量快速通过（一键审批），但仍需经过 `approved` 状态才进入图谱。这样既保留 AI 质量分级对审核优先级的指导价值，又不放弃人工最终决策权。

---

## 五、confidence 多来源合并策略

### 5.1 现有问题

`upsert_entity` 当前取最新 confidence 覆盖旧值（`COALESCE(?1, confidence)` 当 `?1` 非 NULL 时覆盖），与"多来源增强置信度"的直觉相反：低质量来源的 AI 提取会降低高质量来源建立的 confidence。

### 5.2 建议策略

引入 `confidence_strategy` 字段，支持多种合并方式：

| 策略 | 公式 | 适用场景 |
|---|---|---|
| `max` | `MAX(existing, new)` | 取历史最高，保守但防降级 |
| `weighted_average` | `(existing * n + new) / (n + 1)` | n = source_count，多来源加权平均 |
| `bayesian` | 贝叶斯更新 | 高精度场景，实现复杂 |

**MVP 阶段建议：取 `MAX`。** 合并逻辑在 `upsert_entity` 中：

```sql
UPDATE entity
SET confidence = MAX(COALESCE(confidence, 0), COALESCE(?1, 0)),
    source_count = source_count + 1,
    updated_at = ?2
WHERE id = ?3
```

即：若新 confidence 更高则更新，否则保留原值。任意来源都不会降低已建立的置信度。

---

## 六、如何避免 AI 推测污染知识图谱

### 6.1 入库前隔离

所有 AI 输出必须经过 `pending_review` 阶段，**未经 `approved` 的记录不参与知识图谱查询和可视化**。这是最根本的隔离机制。

### 6.2 结构化标注

- `created_by = 'ai'` 与 `created_by = 'human'` 的记录在 UI 层显示不同视觉标记。
- `mapping_level` 字段强制四档语义（`source_fact` / `reasonable_inference` / `hypothesis` / `uncertain`），禁止模糊表述进入数据库。
- `review_reason` 命名空间（`system:*` / `ai:*`）使自动化过滤可行。

### 6.3 Prompt 层防护

- confidence 三档阈值声明（≥0.85 / 0.50–0.84 / <0.50）与代码完全对齐，防止 AI 虚报置信度。
- `western_mapping` 专项指令：`source_fact` 仅用于原文明确陈述的生物医学等价。
- 低置信度条目的处置原则：`< 0.50 = uncertain, omit unless significant`，鼓励 AI 主动省略而非填充不确定内容。

### 6.4 Schema 层约束

- `herb_toxic_level` 非 NULL → 关系强制 `pending_review`
- `herb_incompatible_with` 关系 → 强制 `pending_review`
- `western_mapping` 表 → DEFAULT `pending_review`
- `mechanism_type = 'biomedical_hypothesis'` → 强制 `pending_review`

### 6.5 审核层防护

- 审核 UI 应支持查看 `source_text`（原文段落）和关联 `evidence_id`，使审核员能直接核对原文。
- 审核员标记 `rejected` 的条目不删除，保留为 `rejected` 状态，支持审计追踪。
- `needs_revision` 状态允许将条目打回重新提交，避免直接删除。

---

## 七、如何保留原文证据链

### 7.1 三层证据结构

```
Source（来源文献）
  └── document_chunk（文本切片）
        └── evidence（证据节点，精确段落）
              └── 关联到 relation / mechanism / western_mapping
```

### 7.2 每条关系的证据字段

```sql
relation.source_text    -- 快速访问：内联原文片段（允许冗余存储，方便展示）
relation.evidence_id    -- 精确索引：关联 evidence 表（完整上下文）
relation.source_id      -- 来源文献溯源
```

"内联 + 外键"的双轨设计：`source_text` 作为 fast path（展示时无需 JOIN），`evidence_id` 作为 precise path（需要完整上下文时查询）。

### 7.3 Evidence 节点的唯一性

同一原文段落被多条关系引用时，**共享同一 evidence 行**（通过 `evidence_id` 关联），而非重复复制文本。这实现了：
- 原文修正时，只需更新一行 evidence，所有关联关系自动继承更正。
- 审核员核查同一段原文时，可一次看到该段落支撑的所有关系。

### 7.4 证据链展示规范

- 知识图谱中每条边（relation）应支持"查看证据"操作，展示 `source_text` 和 `source.title`。
- 根据 `mapping_level` 标注展示标签（如"原文直接陈述 / 合理推断 / 假说"）。
- `confidence` 数值以进度条或颜色编码展示，不以确定性语气描述 < 0.85 的条目。

---

## 八、新增表汇总（与现有 Schema 的增量关系）

| 表名 | 状态 | 说明 |
|---|---|---|
| `source` | 已存在，需新增字段 | `review_status`, `evidence_level`, `peer_reviewed`, `publication_type` |
| `entity` | 已存在，需新增字段 | `source_text`, `review_status`, `review_reason`, `created_by`，补充 `updated_at` |
| `relation` | 已存在，需新增字段 | `source_text`, `evidence_id`, `mapping_level`, `review_reason`, `created_by`，补充 `updated_at` |
| `review_item` | 已存在，需新增字段 | `resolved_at`, `reviewer_id`, `review_status`（完整状态机） |
| `evidence` | **全新表** | 独立证据节点，支持跨关系复用 |
| `mechanism` | **全新表** | 机制解释节点（TCM 理论 / 生物医学假说） |
| `biomedical_concept` | **全新表** | 西医概念，独立于 TCM entity 表 |
| `western_mapping` | **全新表** | 从 review_item.risk_flags 升级为可查询表，强制 pending_review |
| `entity_extension` | **可选新表** | 各实体类型的专属扩展字段（herb 归经、formula 组成等） |

> 注：以上所有变更均为**建议草案**，未执行任何 migration。实施前需用户确认范围与优先级。

---

## 九、实施优先级建议

| 优先级 | 项目 | 理由 |
|---|---|---|
| **P0** | `review_item` 补充 `resolved_at` / `reviewer_id` / 完整 `review_status` | 审核闭环的最小可用前提，不依赖新表 |
| **P0** | `entity` + `relation` 补充 `review_status` / `review_reason` / `created_by` | 当前缺少，导致实体审核无状态管理 |
| **P1** | `western_mapping` 独立表 | 替换 `review_item.risk_flags` 中的序列化存储，使中西映射可查询 |
| **P1** | `evidence` 独立表 | 实现原文溯源的精确索引，是图谱可信度的基础设施 |
| **P2** | `biomedical_concept` 独立表 | 将西医概念从 entity 表分离，防止概念污染 |
| **P2** | `mechanism` 独立表 | 记录 AI 推断的生物医学机制，并强制隔离审核 |
| **P3** | `entity_extension` 扩展表 | herb 归经、formula 组成等专属字段 |
| **P3** | confidence 合并策略改为 MAX | 防止低质量来源降低已确立的置信度 |

---

## 十、未解决的设计问题（待讨论）

1. **审核员身份**：当前设计预留 `reviewer_id` 字段，但 MVP 是单用户桌面应用，是否需要区分"用户自己审核"与"系统自动审核"？
2. **批量审核 UI**：`pending_review` 队列如何分页、过滤（按 entity_type / confidence / review_reason 前缀）？
3. **`needs_revision` 的修订机制**：打回后谁来修订——重跑 AI？用户手动编辑？
4. **图谱版本控制**：`archived` 状态是否需要关联"取代它的新记录 ID"，以实现关系图谱的版本溯源？
5. **A 级批量审批 UX**：如何设计"一键批量通过 A 级条目"而不让用户感到责任被绕过？
