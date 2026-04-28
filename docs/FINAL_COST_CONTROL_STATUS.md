# TCM Knowledge Engine — 成本控制最终状态

**固化日期：2026-04-28**

---

## 推荐链路

```
App → LiteLLM Local (127.0.0.1:4000) → OpenRouter → Claude Sonnet 4.6
```

## 备用链路

```
App → OpenRouter 直连 → Claude Sonnet 4.6
```

> 两条链路均已验证可用。直连更简单；LiteLLM Local 提供本地请求日志和速率控制。

---

## 已实现功能

| 功能 | 说明 |
|------|------|
| max_tokens=1800 | 防止结构化输出截断，finish_reason=="length" 时返回明确中文错误 |
| PROMPT_VERSION=TCM_STRUCTURER_V2 | prompt 变更自动失效旧缓存 |
| SHA-256 exact hash cache | 相同输入直接返回缓存，不消耗 API 额度 |
| ai_usage_log | 每次调用（含缓存命中）均记录 model/tokens/cost/cache_hit |
| API Key 编辑保护 | 编辑时 key 留空 = 保留原值；拒绝含 `****` 的掩码 key |
| keyDiagnostic | 配置页展示 present/len/prefix8/last4，不暴露完整 key |
| JSON 截断处理 | finish_reason 检测 + 500-char JSON preview 错误提示 |
| 输入 normalize | 多余空白压缩，缓存命中率更高 |
| LiteLLM Local 接入 | config.example.yaml + .env.example + 启动文档 |

---

## 已验证事项（2026-04-28）

- [x] OpenRouter 直连：测试连接成功
- [x] LiteLLM Local 启动：Uvicorn running on 0.0.0.0:4000
- [x] App → LiteLLM Local → OpenRouter → Claude Sonnet 4.6：测试连接成功
- [x] 短文本 AI 结构化（麻黄汤，约 50 字）：entities 列表正常返回
- [x] 相同文本二次结构化：命中 exact cache，cacheHitCount +1，cost 不变
- [x] JSON 截断错误处理：max_tokens 不足时显示中文提示而非原始 EOF
- [x] LiteLLM 502 根因定位：系统代理拦截 localhost（见 docs/LITELLM_502_DIAG.md）

---

## 当前 OpenRouter 额度

| 项目 | 数值 |
|------|------|
| 剩余额度（2026-04-28） | ~$7.61 |
| 开发预算上限（自设） | $12.00 |
| 单次短文本调用成本 | ~$0.002–$0.006（1800 max_tokens） |

### 使用纪律

- 每次测试前确认 exact cache 是否已有命中，避免重复调用。
- 长文本（>500 字）先分段再结构化，避免截断重试浪费额度。
- 不在 `npm run tauri dev` 热重载期间反复触发 AI 结构化。
- 不在未确认 NO_PROXY 正确的情况下频繁点击「测试连接」。

---

## 当前不做事项

| 不做 | 原因 |
|------|------|
| Redis 缓存 | exact cache 已在 App SQLite 中，无需额外依赖 |
| Langfuse / Helicone | 可观测性需求尚未出现 |
| 复杂模型路由 / fallback | 单模型路径已满足 MVP 需求 |
| 自动 fallback | 增加调试复杂度，掩盖真实错误 |
| 外网暴露 LiteLLM 端口 | 仅本机 127.0.0.1，不开放外网 |
| 多 provider 同时激活 | 任意时刻只有一个「当前」配置 |

---

## 关键配置（当前）

```
Base URL:   http://127.0.0.1:4000
Model Name: claude-sonnet
API Type:   chat_completions
App API Key: sk-local-litellm
```

> OpenRouter Key 只放在本机环境变量，不提交仓库。LiteLLM config.yaml 不应提交真实 key。

---

## 关键文件位置

| 文件 | 用途 |
|------|------|
| `litellm/config.example.yaml` | LiteLLM 配置模板 |
| `litellm/config.yaml` | 本地实际配置（不提交） |
| `litellm/.env` | 本地密钥（不提交） |
| `docs/LITELLM_LOCAL_SETUP.md` | 启动步骤与代理设置 |
| `docs/LITELLM_VALIDATION_CHECKLIST.md` | 接入验证清单 |
| `docs/LITELLM_502_DIAG.md` | 502 根因与修复方案 |
| `docs/RUNTIME_VALIDATION_CHECKLIST.md` | OpenRouter 直连验证清单 |
