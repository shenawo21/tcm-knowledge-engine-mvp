# 成本受限 LiteLLM + Claude Sonnet 4.6 实施方案

**预算上限：OpenRouter $12 | 目标：个人生产可用 | 日期：2026-04-28**

---

## 一、当前 AI 调用链分析

```
用户输入（前端 IngestionPage）
  │
  ▼ invoke("process_with_ai", { inputText, promptType })
src-tauri/src/commands.rs
  │  MAX_INPUT_TEXT_CHARS = 10_000
  │  读取 DB 中 active model config（base_url / model_name / api_key）
  │  回退：env OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL
  │
  ▼ ai_processor::process(&text, config_opt)
src-tauri/src/ai_processor.rs
  │  build_endpoint_url(base_url, api_type)
  │  reqwest POST → /v1/chat/completions（OpenAI-compatible）
  │  temperature: 0.3，max_tokens: 未限制（主请求）
  │  test_connection：max_tokens: 5
  │
  ▼ 返回 JSON → 前端 ReviewPage 展示
```

**关键观察：**
- 主请求**未设置 max_tokens**，Claude Sonnet 4.6 默认输出上限 8 192 token，单次调用可能消耗 $0.15–$0.40。
- 每个 prompt 模板约 17–18 行，含结构化 JSON 指令，输入 token 约 400–600。
- 无 usage log，无每日上限，无缓存机制。
- 模型配置通过 SQLite 存储，可动态切换 base_url / model_name，**无需改代码即可接入 LiteLLM Proxy**。

---

## 二、$12 预算下的开发纪律

| 规则 | 说明 |
|------|------|
| 每次 AI 调用前估算 token | 输入 ≤ 2 000 token，输出限制 1 200 token |
| 不做批量测试调用 | 功能验证用 mock 或最小文本 |
| 每阶段消耗记录 | 在此文档末尾追加 usage log |
| 每日预算软上限 $1 | 超出后停止 AI 调用，改看日志 |
| 不跑压测 | 无并发测试，无自动化回归 |
| 优先用 exact cache | 相同 prompt + 相同输入 → 不重复调用 |

OpenRouter Claude Sonnet 4.6 价格参考（2026-04）：
- 输入：$3 / 1M token
- 输出：$15 / 1M token

$12 可支持约：输入 800K token + 输出 400K token，
即约 **200–400 次完整知识结构化调用**（每次输入 ~2K token，输出 ~1K token）。

---

## 三、最小生产可用范围（MVP Scope）

**做：**
1. OpenRouter 直连 Claude Sonnet 4.6（已部分支持，需补 max_tokens 限制）
2. SQLite usage_log 表，记录每次调用的 input_tokens / output_tokens / model / cost_usd
3. max_output_tokens 强制设为 1 200，防止超支
4. exact hash cache：相同 sha256(prompt_version + prompt_type + model_name + api_type + normalized_input_text) → 返回缓存结果，不调 AI
5. 前端展示本次预算消耗已用 / 上限（简单文字，不需图表）
6. LiteLLM Proxy 本地接入（可选阶段，仅 1 个 model，无 load balancing）

**不做（明确排除）：**
- Redis / Langfuse / Helicone / Kubernetes
- 多 provider 自动路由或 fallback
- 实时流式输出
- 多用户 / 多环境
- 企业级 HA、监控告警
- 自动化测试套件
- 向量语义缓存（太复杂，用 exact hash 足够）

---

## 四、数据库改动设计

### 新增表：`ai_usage_log`

```sql
CREATE TABLE IF NOT EXISTS ai_usage_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    model           TEXT    NOT NULL,
    prompt_type     TEXT    NOT NULL,           -- case / paper / general
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    cost_usd        REAL    NOT NULL DEFAULT 0.0,
    cache_hit       INTEGER NOT NULL DEFAULT 0, -- 0=miss, 1=hit
    task_id         INTEGER REFERENCES ingestion_tasks(id)
);
```

### 新增表：`ai_exact_cache`

```sql
CREATE TABLE IF NOT EXISTS ai_exact_cache (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    prompt_hash     TEXT    NOT NULL UNIQUE,    -- sha256(prompt_version||prompt_type||model_name||api_type||"\0"||normalized_input_text)
    prompt_version  TEXT    NOT NULL,
    prompt_type     TEXT    NOT NULL,           -- case / paper / general
    api_type        TEXT    NOT NULL,
    max_tokens      INTEGER NOT NULL DEFAULT 1200,
    response_json   TEXT    NOT NULL,
    model           TEXT    NOT NULL,
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0
);
```

> **迁移说明：** 不能只修改 `schema.sql`。已有 SQLite 数据库必须通过 `CREATE TABLE IF NOT EXISTS` 兼容迁移——即在 Rust 启动时执行建表语句，新字段通过新建表而非 `ALTER TABLE` 添加。若 `ai_exact_cache` 已存在旧版本，需在迁移脚本中 `DROP TABLE IF EXISTS ai_exact_cache` 后重建，或使用 `ALTER TABLE ai_exact_cache ADD COLUMN` 逐列补齐。推荐在 `repository.rs` 的 `run_migrations()` 中统一管理。

### 现有表无需修改

`ai_model_config` 已有 `base_url` / `model_name` 字段，LiteLLM Proxy 接入只需在 UI 更新值即可。

---

## 五、Rust 后端改动设计

### 5.1 `ai_processor.rs` — 补 max_tokens 限制

在主请求 JSON body 中增加：
```json
"max_tokens": 1200
```
当前 test_connection 已有 `max_tokens: 5`，无需改动。

### 5.2 `ai_processor.rs` — 解析 usage 字段

```rust
// OpenAI-compatible response 的 usage 字段
struct UsageInfo {
    prompt_tokens: u32,
    completion_tokens: u32,
}
```
从 response JSON 提取，传给 `repository.rs` 写入 `ai_usage_log`。

### 5.3 `ai_processor.rs` — exact hash cache

调用前：
```rust
let normalized = input_text.split_whitespace().collect::<Vec<_>>().join(" ");
let hash = sha256(format!("{}{}{}{}\0{}", prompt_version, prompt_type, model_name, api_type, normalized));
if let Some(cached) = repo.get_exact_cache(&hash) {
    // 写 usage_log（cache_hit=1, cost_usd=0）
    return Ok(cached.response_json);
}
```
调用成功后写入 `ai_exact_cache`（含 prompt_version / prompt_type / api_type / max_tokens）。

### 5.4 新增 Tauri 命令

```rust
#[tauri::command]
pub async fn get_usage_summary() -> Result<UsageSummary, String>
// 返回：total_cost_usd, total_calls, cache_hit_count, today_cost_usd
```

### 5.5 依赖说明

- `sha2`（sha256）：Cargo.toml 新增 `sha2 = "0.10"`
- 无其他新依赖

---

## 六、前端最小改动设计

仅在 `ModelSettingsPage.tsx` 或 `Dashboard.tsx` 添加一行文字展示：

```
AI 调用统计：本月 $x.xx / $12.00 | 命中缓存 n 次 | 总调用 n 次
```

通过新 `invoke("get_usage_summary")` 获取数据。

**不改动：** `IngestionPage.tsx`、`ReviewPage.tsx`、`KnowledgePage.tsx`、`GraphPage.tsx`、`Sidebar.tsx`、`aiProcessor.ts`、`types.ts`（除非新增 `UsageSummary` 类型）。

---

## 七、OpenRouter 直连阶段设计（阶段一）

**目标：** 立即可用，无额外部署。

**操作步骤：**
1. 在 UI 模型配置页面设置：
   - `base_url` = `https://openrouter.ai/api/v1`
   - `model_name` = `anthropic/claude-sonnet-4.6`
   - `api_type` = `chat_completions`
   - `api_key` = `<OpenRouter Key>`（存入 SQLite 加密字段）
2. Rust 侧补 `max_tokens: 1200`
3. 补 usage_log 写入
4. 补 exact hash cache

**验证：** 发送一条 200 字医案文本，确认结果正确、cost_usd 已记录。

---

## 八、LiteLLM Proxy 接入阶段设计（阶段二，可选）

**目标：** 本地 LiteLLM Proxy 统一入口，便于日志、限速、未来切模型。

**最小配置（`litellm_config.yaml`，不提交到仓库）：**
```yaml
model_list:
  - model_name: claude-sonnet
    litellm_params:
      model: openrouter/anthropic/claude-sonnet-4.6
      api_key: os.environ/OPENROUTER_API_KEY
      max_tokens: 1200

general_settings:
  max_budget: 12.0
  budget_duration: "monthly"
```

**本地启动：**
```bash
pip install litellm[proxy]
litellm --config litellm_config.yaml --port 4000
```

**接入方式：** 在 DB 中将 base_url 改为 `http://127.0.0.1:4000`，model 改为 `claude-sonnet`，api_key 改为 LiteLLM master key。

> **base_url 注意：** `build_endpoint_url()` 会在 `base_url` 末尾拼接 `/v1/chat/completions`（`chat_completions` 类型）。LiteLLM Proxy 默认监听根路径，因此：
> - 若 `api_type = chat_completions`，应将 `base_url` 设为 `http://127.0.0.1:4000`（不带 `/v1`），由 `build_endpoint_url()` 自动补全为 `http://127.0.0.1:4000/v1/chat/completions`。
> - 若 LiteLLM Proxy 已挂载在 `/v1` 路径下，则将 `base_url` 设为 `http://127.0.0.1:4000/v1`，并确认 `build_endpoint_url()` 不会重复拼接 `/v1`。
> - 实际接入前应先用 `test_connection` 命令验证 endpoint 可达。

**不修改任何业务代码**，仅改 DB 中的模型配置。

---

## 九、Exact Hash Cache 策略

- **Cache key：** `sha256(prompt_version + prompt_type + model_name + api_type + "\0" + normalized_input_text)`
  - 包含 model_name 和 api_type，确保切换模型或接口类型后旧 cache 不会被错误命中。
  - normalized_input_text = 原文去除多余空白后 join，消除输入格式差异。
  - prompt_type 区分 case / paper / general，变更 prompt 模板内容时递增 prompt_version。
- **Cache 存储：** SQLite `ai_exact_cache` 表，本地文件，无网络依赖。
- **Cache 失效：** 手动清空（提供 `clear_ai_cache` 命令），不做 TTL 自动过期。
- **Cache 命中率预期：** 知识库录入场景重复率低，主要用于开发调试阶段防止重复调用。

**Prompt 版本控制：**
```rust
const PROMPT_VERSION: &str = "v1";
let normalized = input_text.split_whitespace().collect::<Vec<_>>().join(" ");
let hash = sha256(format!("{}{}{}{}\0{}", PROMPT_VERSION, prompt_type, model_name, api_type, normalized));
```
每次修改 prompt 模板时递增 `PROMPT_VERSION`，旧 cache 自动失效。

---

## 十、Usage Log 策略

- 每次 AI 调用（含 cache hit）写入 `ai_usage_log` 一行。
- `cost_usd` 在 Rust 侧按如下公式估算（避免依赖 OpenRouter 返回的计费数据）：
  ```
  cost = input_tokens * 0.000003 + output_tokens * 0.000015
  ```
- 不写入任何 input_text 原文，仅写 prompt_type 和 token 数，保护医案隐私。
- 日志不做 rotation，SQLite 自带持久化。

---

## 十一、max_output_tokens 策略

- **主请求：** `max_tokens: 1200`（约 880 字中文，足够单条知识结构化输出）
- **test_connection：** `max_tokens: 5`（保持现状）
- **设计原则：** 宁可截断输出（AI 会在 1 200 token 处停止），也不允许无限输出。若输出被截断（`finish_reason: length`），ReviewPage 应显示警告"AI 输出可能不完整，请缩短输入"。

---

## 十二、模型路由策略

当前阶段：**单一模型，不做路由**。

未来扩展预留（不实现）：
- 短文本（< 500 字）可路由到更便宜模型
- 但**编码任务不能自动降级**（见下节）

---

## 十三、为什么编码任务不能自动降级

本系统中的"AI 任务"是中医知识结构化，不是编码。
但若未来引入 AI 辅助代码生成：

- 编码任务对模型能力极度敏感，降级到弱模型会导致：
  - 类型错误、逻辑错误不易被发现
  - 测试通过但语义错误
  - 安全漏洞（SQL 注入、XSS）
- 成本节约 < 错误修复代价
- **结论：** 编码任务必须用指定模型，不做自动降级或 fallback。

---

## 十四、验证集设计

| 场景 | 测试用例 | 预期 |
|------|----------|------|
| 正常医案结构化 | 100 字标准医案 | 返回有效 JSON，cost < $0.02 |
| 超长输入 | 10 001 字 | 返回错误"超出字符限制" |
| cache 命中 | 同文本发送两次 | 第二次 cache_hit=1，cost=0 |
| max_tokens 截断 | 超大输出场景 | finish_reason=length，前端显示警告 |
| test_connection | 任意配置 | 5 token 响应，cost < $0.001 |

**验证工具：** 直接在应用 UI 操作，查看 SQLite `ai_usage_log` 表确认。

---

## 十五、生产验收标准

- [ ] API miss 时 `ai_usage_log` 有记录且 `cost_usd > 0`
- [ ] cache hit 时 `ai_usage_log` 有记录且 `cost_usd = 0`，`cache_hit = 1`
- [ ] 相同输入两次调用，第二次 `cache_hit=1`
- [ ] `ai_processor.rs` 主请求包含 `max_tokens: 1200`
- [ ] `finish_reason: length` 时前端有可见警告
- [ ] Dashboard / ModelSettings 显示累计消耗（精确到 $0.01）
- [ ] `npm run build` 通过
- [ ] `cargo check` 通过

---

## 十六、回滚方案

阶段一（OpenRouter 直连）：
- 在 UI 将 `base_url` 改回原始值即可，无代码变更回滚需求。
- DB 迁移（新增表）不影响现有功能，无需回滚脚本。

阶段二（LiteLLM Proxy）：
- 停止 LiteLLM 进程，将 DB 中 `base_url` 改回 OpenRouter 直连 URL。
- 无代码变更。

---

## 十七、分阶段实施命令

### 阶段一：补 max_tokens + usage_log + exact cache（代码改动）

```bash
# 1. 修改 ai_processor.rs（加 max_tokens、解析 usage、sha2 hash cache）
# 2. 修改 repository.rs（写 ai_usage_log、ai_exact_cache）
# 3. 修改 commands.rs（添加 get_usage_summary 命令）
# 4. 修改 lib.rs（注册新命令）
# 5. 修改 Cargo.toml（添加 sha2 依赖）
# 6. 验证
cargo check --manifest-path src-tauri/Cargo.toml
npm run build
```

### 阶段二：前端展示 usage summary（最小 UI）

```bash
# 修改 ModelSettingsPage.tsx 或 Dashboard.tsx（添加 invoke get_usage_summary）
npm run build
```

### 阶段三（可选）：LiteLLM Proxy 本地部署

```bash
pip install litellm[proxy]
# 创建 litellm_config.yaml（不提交到仓库）
litellm --config litellm_config.yaml --port 4000
# 在 UI 更新 base_url = http://127.0.0.1:4000（不带 /v1，由 build_endpoint_url() 自动补全）
```

---

## 十八、开发预算消耗记录（待追加）

| 日期 | 阶段 | 调用次数 | 消耗 $USD | 备注 |
|------|------|----------|-----------|------|
| 2026-04-28 | 方案文档生成 | 0 | $0.00 | 未改业务代码 |

---

*最后更新：2026-04-28 | 本文档仅记录实施方案，不包含任何 API Key 或敏感配置。*
