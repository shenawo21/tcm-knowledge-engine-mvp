# 长文本自动分段 + 分块结构化队列 — 最小实现方案

**日期：** 2026-04-28  
**状态：** 设计草案，待用户确认后进入实现  
**约束：** 不改现有表结构，不接 PDF，不做整书入库，不接 Redis

---

## 一、当前单段结构化能力边界

| 指标 | 当前值 | 说明 |
|------|--------|------|
| max_tokens（输出） | 2400 | 超出触发 finish_reason=length |
| 推荐输入上限 | 800 字 | compact prompt 策略下，800 字输入约消耗 1800–2200 输出 token |
| 安全输入范围 | ≤ 500 字 | 高密度理论文本；普通条文可到 800 字 |
| 单次调用费用 | ~$0.002–$0.006 | Claude Sonnet 4.6，含缓存命中场景为 $0 |
| 输入硬限制 | 10 000 字符 | `MAX_INPUT_TEXT_CHARS` 在 commands.rs 中 |

---

## 二、为什么不能直接处理 PDF / 整本书

1. **输出 token 瓶颈**：模型上下文窗口虽大，但结构化 JSON 输出在 2400 token 内必须完整闭合。整书内容产生的实体/关系数量远超限制，必然截断。
2. **结构化质量下降**：输入过长时模型注意力分散，低质量推断比例上升，confidence 虚高。
3. **成本不可控**：整书单次调用可能消耗数万 token，无法做缓存复用（每次输入不同）。
4. **失败无法定位**：一次失败意味着整本书需重跑，无法精准重试某一段。
5. **缺乏 OCR 管道**：PDF → 文字的步骤尚未实现，不在当前 MVP 范围。

---

## 三、Chunk 大小建议

| 文本类型 | 推荐 chunk 大小 | 理由 |
|----------|----------------|------|
| 高密度中医理论（病机、方论） | 300–500 字 | 概念密度高，500 字可产生 12+ 实体，接近 compact 上限 |
| 普通条文（《伤寒论》《金匮要略》） | 500–800 字 | 结构清晰，语义边界明确，800 字内输出稳定 |
| 医案（含诊断、处方、转归） | 800–1000 字 | 叙事结构完整，分段会割裂诊疗链，允许略宽 |

**分段原则（优先级从高到低）：**
1. 以自然段落（空行）为边界
2. 以句号/分号为边界
3. 对于无标点古文，以语义单元（一首方、一条证、一段案语）为边界
4. 最后才按字数硬切

---

## 四、前端交互设计

### 4.1 输入区状态提示

| 输入字数 | 提示行为 |
|----------|----------|
| ≤ 800 字 | 无提示，正常显示「开始 AI 结构化」 |
| 801–1500 字 | 黄色警告："文本较长，建议手动分段后分别结构化" + 字数显示 |
| > 1500 字 | 橙色警告："文本超出推荐长度，建议自动分段" + 「自动分段预览」按钮 |

### 4.2 自动分段预览（> 1500 字时）

- 点击「自动分段预览」弹出面板
- 显示分段结果：Chunk 1 / Chunk 2 / … 及每段首尾文字
- 每段显示估计字数
- 用户可手动合并相邻 chunk（拖拽或点击合并按钮）
- 确认后进入队列执行

### 4.3 分块队列 UI

```
[Chunk 1 — 478字]  ● 处理中...
[Chunk 2 — 512字]  ✅ 已完成  查看结果
[Chunk 3 — 431字]  ⏸ 等待中
[Chunk 4 — 389字]  ❌ 失败     重试
```

- 每块独立状态，失败只重试当块
- 全部完成后显示「查看合并知识图谱」入口（Phase 2 实现，当前只显示占位）
- 进度：「已完成 2 / 4 块，累计消耗 $0.0041」

### 4.4 单块失败重试

- 点击「重试」仅重跑该 chunk（缓存 key 不变，命中则免费）
- 不影响其他 chunk 状态
- 失败原因显示在 chunk 行下方（截断提示 / 网络错误 / JSON 解析失败）

---

## 五、后端设计

### 5.1 Rust 命令新增

| 命令 | 签名摘要 | 说明 |
|------|----------|------|
| `split_text_into_chunks` | `(text, chunk_type) -> Vec<ChunkPreview>` | 纯计算，不写 DB |
| `create_chunked_task` | `(parent_task_id, chunks: Vec<String>) -> Vec<String>` | 写 chunk 记录，返回 chunk_id 列表 |
| `process_chunk` | `(chunk_id) -> AiResult` | 复用 process_with_ai 逻辑，操作单块 |
| `get_chunk_status` | `(parent_task_id) -> Vec<ChunkStatus>` | 轮询用 |

### 5.2 Chunk 数据字段

```
chunk_id        TEXT PRIMARY KEY   — UUID
parent_task_id  TEXT NOT NULL       — 关联 ingestion_tasks.id
chunk_index     INTEGER NOT NULL    — 0-based 顺序
chunk_text      TEXT NOT NULL       — 原始文本片段
chunk_status    TEXT NOT NULL       — pending | running | done | failed
result_json     TEXT                — 结构化结果（done 时写入）
cache_key       TEXT                — SHA-256，与 process_with_ai 相同算法
error_msg       TEXT                — 失败原因
created_at      TEXT NOT NULL
updated_at      TEXT NOT NULL
```

### 5.3 分段算法（Rust 侧，无 AI 调用）

```
输入：text: &str, chunk_type: &str
输出：Vec<String>（每段文本）

逻辑：
1. 按双换行（自然段落）切分
2. 若某段 > target_size × 1.5，按句号再切
3. 若仍过长，按 target_size 硬切（UTF-8 安全）
4. 合并过短的相邻段（< target_size × 0.3）至下一段
5. 返回段落列表

target_size 由 chunk_type 决定：
  "theory"  → 400
  "formula" → 650
  "case"    → 900
  默认       → 600
```

---

## 六、数据库最小新增表

```sql
CREATE TABLE IF NOT EXISTS ingestion_chunks (
    chunk_id        TEXT PRIMARY KEY,
    parent_task_id  TEXT NOT NULL REFERENCES ingestion_tasks(id),
    chunk_index     INTEGER NOT NULL,
    chunk_text      TEXT NOT NULL,
    chunk_status    TEXT NOT NULL DEFAULT 'pending',
    result_json     TEXT,
    cache_key       TEXT,
    error_msg       TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chunks_parent
    ON ingestion_chunks(parent_task_id, chunk_index);
```

**迁移策略：** 沿用现有 `ensure_ai_cost_tables()` 模式，新增 `ensure_chunk_table()` 函数，在 `create_chunked_task` 命令首次调用时执行，不影响现有数据库。

---

## 七、不做事项

| 不做 | 原因 |
|------|------|
| PDF OCR / 文档解析 | 需引入额外依赖（Tesseract / PDFium），不在 MVP 范围 |
| 整书自动入库 | 成本不可控，缺乏质量门控，待验证集完成后再评估 |
| 多模型路由 | 当前 Claude Sonnet 4.6 已满足需求，路由引入调试复杂度 |
| chunk 合并知识图谱 | Phase 2 功能：需要实体去重、关系跨块合并算法 |
| 并发多块同时调用 | 首版单块串行，避免并发超过 OpenRouter 速率限制 |
| 自动重试 | 失败需用户确认再重试，避免消耗预算 |

---

## 八、分阶段实现计划

### Phase 1 — 前端感知 + 手动分段（最小可用，约 2–3 天）

- [ ] 输入区字数统计 + 三档提示（正常 / 警告 / 建议分段）
- [ ] 「自动分段预览」面板（调用 `split_text_into_chunks`，纯前端渲染）
- [ ] 用户手动确认后，逐块串行调用现有 `process_with_ai`
- [ ] 前端 chunk 队列状态展示（pending / running / done / failed）
- [ ] 单块失败重试按钮
- **不新增数据库表**，chunk 状态仅在前端 state 管理

### Phase 2 — 后端持久化队列（约 3–4 天，Phase 1 完成后）

- [ ] 新增 `ingestion_chunks` 表（迁移安全）
- [ ] 实现 `create_chunked_task` / `process_chunk` / `get_chunk_status` 命令
- [ ] 前端改为轮询 `get_chunk_status`，支持刷新页面后恢复进度
- [ ] chunk 结果写入 DB，可在知识库页按 parent_task_id 聚合查看

### Phase 3 — 跨块知识合并（评估中，不设时间表）

- [ ] 实体去重（按 name + type 合并）
- [ ] 跨块关系合并（from/to 对应同一实体时合并）
- [ ] 合并后知识图谱可视化

---

## 九、验证标准

### Phase 1 验收

| 验收项 | 通过标准 |
|--------|----------|
| 字数提示 | 输入 800 字出现黄色警告，1500 字出现橙色警告 |
| 分段预览 | 点击「自动分段预览」显示正确段落数和首尾文字 |
| 逐块结构化 | 每块独立调用，done/failed 状态正确更新 |
| 缓存复用 | 重试同一块时命中缓存，費用不增加 |
| 失败隔离 | 某块失败不影响其他块继续运行 |
| 成本记录 | usage 统计正确累加每块费用 |

### Phase 2 验收（额外）

| 验收项 | 通过标准 |
|--------|----------|
| 持久化 | 关闭 App 重开后，队列状态可恢复 |
| 迁移安全 | 旧数据库（无 ingestion_chunks 表）不报错 |
| 知识库聚合 | 知识库页可按 parent_task_id 查看所有块结果 |

### 成本上限

- Phase 1 验证：10 块 × $0.006 = **$0.06**（可接受）
- Phase 2 验证：同上

**单次验证预算上限：$0.10**
