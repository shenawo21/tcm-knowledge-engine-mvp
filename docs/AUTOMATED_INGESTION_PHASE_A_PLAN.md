# 半自动采集 Phase A：采集任务队列 — 最小实现方案

**日期：** 2026-04-28  
**状态：** 设计草案，待用户确认后进入实现  
**约束：** 不做 PDF/爬虫/定时采集/无人审核自动入库，不接 Redis

---

## 一、当前能力边界

| 能力 | 状态 | 说明 |
|------|------|------|
| 单段结构化 | ✅ 已验证 | `process_with_ai`，≤800 字最稳定 |
| 长文本前端分段 | ✅ Phase 1 完成 | 前端 state 管理，刷新即丢失 |
| exact hash cache | ✅ 已验证 | 相同输入免费命中，写 SQLite |
| usage log | ✅ 已验证 | 每次调用记录 cost/tokens/cache_hit |
| chunk 状态持久化 | ❌ 未实现 | 刷新页面队列消失 |
| 任务可追踪 | ❌ 未实现 | 无任务列表，无历史记录 |
| 失败块跨会话重试 | ❌ 未实现 | 依赖前端 state，关 App 即失效 |

---

## 二、Phase A 目标

**目标：** 将前端临时 chunk 队列升级为数据库持久化的可追踪采集任务队列。

核心能力：
- 用户粘贴文本 → 自动分段 → 创建持久化任务 → 逐块 AI 结构化
- 每个 chunk 状态写入 DB，刷新/重启不丢失
- 失败 chunk 可在任务详情页单独重试
- 全部 chunk done 后进入人工审核入口（审核本身为 Phase A3）
- 不做无人审核自动入库

**不扩大边界：**
- 不自动抓取 URL
- 不解析扫描版 PDF
- 不做定时/批量采集
- 不做多模型路由

---

## 三、前端页面设计

### 3.1 采集任务列表（现有「采集任务」页升级）

现有页面保留单段输入框，在下方新增「任务历史」面板：

```
[任务历史]
┌─────────────────────────────────────────────────────────┐
│ #1  麻黄汤节选  4块  ✅3 ❌1  2026-04-28  [详情] [重试失败块] │
│ #2  胸痹章节    6块  ✅6 ❌0  2026-04-28  [详情] [进入审核]   │
│ #3  足三里医案  2块  ⏸2 ❌0  2026-04-28  [详情] [继续]       │
└─────────────────────────────────────────────────────────┘
```

字段：任务 ID（短）、文本预览（前20字）、总 chunk 数、各状态计数、创建时间、操作按钮。

### 3.2 任务详情页

路由：`/ingestion/:taskId`（或模态层）

分为两个区域：

**上半部分：任务元信息**
- 文本预览（前100字）
- 创建时间
- 总 chunk 数 / 已完成 / 失败 / 等待
- 累计消耗（从 usage_log 聚合）

**下半部分：chunk 状态列表**

```
Chunk 1  478字  ✅ 已完成  [查看结果]
Chunk 2  512字  ❌ 失败    网络超时  [重试该块]
Chunk 3  431字  ⏸ 等待中
Chunk 4  389字  ⏸ 等待中
```

### 3.3 chunk 结果查看

点击「查看结果」展开/弹出该 chunk 的 `result_json` 渲染：
- 实体列表（name / type / confidence）
- 关系列表
- review level + decision
- 不做跨块合并（Phase A3 以后）

### 3.4 失败块重试

- 点击「重试该块」→ 该 chunk status 改为 running → 重新调用 `process_chunk`
- 命中 cache 则免费返回
- 不影响其他 chunk 状态

### 3.5 全部完成后进入审核

当所有 chunk status = done，任务级显示「进入审核」按钮（Phase A3 实现审核逻辑；Phase A1/A2 中此按钮显示为占位，点击跳转知识库页）。

---

## 四、后端设计

### 4.1 新增表：ingestion_chunks

```sql
CREATE TABLE IF NOT EXISTS ingestion_chunks (
    chunk_id        TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES ingestion_tasks(id),
    chunk_index     INTEGER NOT NULL,
    chunk_text_hash TEXT NOT NULL,   -- SHA-256(chunk_text)，用于 dedup 校验
    chunk_text      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    result_json     TEXT,
    error_message   TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chunks_task
    ON ingestion_chunks(task_id, chunk_index);
```

**迁移策略：** 新增 `ensure_chunk_table()` 函数（仿照 `ensure_ai_cost_tables`），在首次调用 `create_chunked_task` 时执行，不影响旧数据库。

### 4.2 新增 Rust 命令

| 命令 | 入参 | 出参 | 说明 |
|------|------|------|------|
| `create_chunked_task` | `input_text, chunk_texts: Vec<String>` | `task_id: String, chunk_ids: Vec<String>` | 写 ingestion_tasks + ingestion_chunks，状态均为 pending |
| `process_chunk` | `chunk_id: String` | `AiResult` | 读chunk_text → 复用 process_with_ai 逻辑 → 写 result_json + status |
| `get_task_chunks` | `task_id: String` | `Vec<ChunkRow>` | 返回任务下所有 chunk 的状态（不含全文，减少传输量） |
| `list_chunked_tasks` | `limit, offset` | `Vec<TaskSummaryRow>` | 返回任务列表（含各状态 chunk 计数） |
| `retry_chunk` | `chunk_id: String` | `AiResult` | 同 process_chunk，chunk status reset → running |

### 4.3 process_chunk 内部逻辑

```
1. 读取 ingestion_chunks WHERE chunk_id = ?
2. 检查 status：若 running/done 则直接返回（幂等保护）
3. UPDATE status = 'running', updated_at = now
4. 调用现有 process_with_ai(chunk_text)
   - 命中 cache → 直接返回（usage log 记录 cache_hit=true）
   - 未命中 → 调用 API → 写 cache → 记录 usage
5. 成功：UPDATE status = 'done', result_json = ?, updated_at = now
6. 失败：UPDATE status = 'failed', error_message = ?, updated_at = now
7. 返回 AiResult（或 propagate Err）
```

**关键约束：**
- step 3 的状态更新在 await 之前（同步操作），避免并发重复调用
- step 5/6 必须在 await 之后（写结果），不提前释放 DB lock

### 4.4 前端串行调度

前端仍负责串行触发（逐个调用 `process_chunk`），不做后台并发：

```
for chunk_id in chunk_ids:
    await invoke('process_chunk', { chunkId })
    // 更新 UI 状态（轮询 get_task_chunks 或前端 local state）
```

串行原因：避免超过 OpenRouter 速率限制，且成本可逐步感知。

---

## 五、状态流转

```
          ┌─────────────────────────────────┐
          │        ingestion_chunk           │
          │                                  │
  创建 ──▶│  pending                         │
          │     │                            │
          │     ▼                            │
          │  running  ◀── retry ──┐          │
          │     │                 │          │
          │     ├── 成功 ──▶  done │          │
          │     │                 │          │
          │     └── 失败 ──▶ failed ──┘       │
          └─────────────────────────────────┘
```

**幂等保护：** `process_chunk` 检查 status，若已为 done 则直接返回缓存结果，防止前端重复触发浪费额度。

---

## 六、与现有能力的关系

| 现有能力 | Phase A 使用方式 | 是否修改 |
|----------|-----------------|----------|
| `process_with_ai` | `process_chunk` 内部调用，完全复用 | ❌ 不修改 |
| exact hash cache | 命中时直接返回，cost=0，cache_hit=true | ❌ 不修改 |
| usage log | 每次 API 调用/缓存命中均记录 | ❌ 不修改 |
| 单段结构化（IngestionPage） | 保留原有路径不变 | ❌ 不修改 |
| 前端 chunk 分段预览 | 确认后改为调用 `create_chunked_task` | 小幅修改 |
| ingestion_tasks 表 | create_chunked_task 写父任务行 | ❌ 不修改表结构 |

---

## 七、不做事项

| 不做 | 原因 |
|------|------|
| 自动爬网页 URL | 需网络权限 + 内容解析管道，不在 MVP 范围 |
| 扫描版 PDF 解析 | 需 OCR 依赖，成本和错误率不可控 |
| 无人审核自动入库 | 医学知识库需人工质控，ai_review 结果只是参考 |
| 定时/批量采集 | 成本不可控，缺乏质量门控 |
| 多模型路由 | 单模型已满足需求，路由增加调试复杂度 |
| 跨块知识合并 | 需实体去重算法，放入 Phase B |
| 并发多块同时调用 | 串行足够，避免超速率限制 |

---

## 八、分阶段实现计划

### Phase A1 — 数据库与后端 chunk 状态（约 1–2 天）

- [ ] 新增 `ingestion_chunks` 表迁移（`ensure_chunk_table`）
- [ ] 实现 `create_chunked_task` 命令（写父任务 + chunk 记录）
- [ ] 实现 `process_chunk` 命令（状态流转 + 复用 process_with_ai）
- [ ] 实现 `get_task_chunks` 命令（状态查询）
- [ ] 实现 `list_chunked_tasks` 命令（任务列表 + 计数）
- [ ] `cargo check` + 单命令手工测试通过

### Phase A2 — 前端任务详情与 chunk 队列（约 2–3 天）

- [ ] 「采集任务」页下方新增「任务历史」面板
- [ ] 任务详情页（路由或模态）
- [ ] chunk 状态列表（轮询 `get_task_chunks`）
- [ ] 串行调用 `process_chunk`，实时更新状态
- [ ] chunk 结果展开查看
- [ ] `npm run build` 通过

### Phase A3 — 重试与审核入口（约 1 天）

- [ ] 失败 chunk「重试该块」按钮（调用 `retry_chunk`）
- [ ] 全任务完成后显示「进入审核」按钮（当前版本跳转知识库页）
- [ ] 实现 `retry_chunk` 命令（幂等保护）

### Phase A4 — 小规模验证（约半天）

- [ ] 用 3-chunk 测试任务完整跑通
- [ ] 手动触发 1 块失败（输入超长文本），验证其他块继续
- [ ] 失败块重试验证（含 cache 命中场景）
- [ ] 验证 usage log 正确累加
- [ ] 验证刷新页面后任务状态保留

---

## 九、验收标准

### 功能验收

| 验收项 | 通过标准 |
|--------|----------|
| 3-chunk 任务完整完成 | 3 块全部 status=done，result_json 非空 |
| 1 块失败隔离 | 某块返回错误，其余块继续执行至 done |
| 失败块重试 | 重试后 status 从 failed → running → done/failed |
| 重启恢复 | 关闭并重新打开 App，任务列表和 chunk 状态保留 |
| usage log 累加 | totalCalls 正确计入每块调用（含 cache_hit） |
| cache 命中 | 对已完成块重试时 cacheHitCount+1，cost 不增加 |

### 工程验收

| 命令 | 要求 |
|------|------|
| `npm run build` | ✅ 通过，无 TS 类型错误 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | ✅ 通过，无编译错误 |
| `cargo fmt -- --check` | ✅ 通过，格式正确 |

### 成本上限

- Phase A4 验证：约 3 块 × 2 次（含重试）× $0.006 = **$0.036**
- 全程验证预算上限：**$0.10**
