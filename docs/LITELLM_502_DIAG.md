# LiteLLM 502 诊断报告

**日期：** 2026-04-28  
**端口：** 4010（诊断用）  
**预算消耗：** 1 次真实 API 调用（$0.000069）

---

## 诊断结论

**根本原因：系统代理环境变量拦截了 localhost HTTP 请求。**

```
HTTP_PROXY=http://127.0.0.1:7897
HTTPS_PROXY=http://127.0.0.1:7897
NO_PROXY=（空）
```

App 的 Rust HTTP 客户端（reqwest）默认读取系统代理环境变量。当 App 请求 `http://127.0.0.1:4000/v1/chat/completions` 时，reqwest 将该请求转发给代理（Clash/VPN，端口 7897），代理无法回环转发至本机 4000 端口，返回 **502 Bad Gateway**。

LiteLLM 本身运行正常，OpenRouter API 密钥有效，配置无误。

---

## 各项检查结果

| 检查项 | 结果 |
|--------|------|
| Python 版本 | 3.13.2 ✅ |
| LiteLLM 版本 | 1.83.14 ✅ |
| config.yaml 存在 | ✅ |
| OPENROUTER_API_KEY | present=true, len=73, prefix=sk-or-v1 ✅ |
| LITELLM_MASTER_KEY（shell env） | 不存在，但 config.yaml 中硬编码 `sk-local-litellm` ✅ |
| litellm/.env 文件 | 不存在（不影响，master_key 已在 config.yaml 中） |
| LiteLLM 启动（端口 4010） | ✅ Uvicorn running |
| GET /health（无代理） | 401（LiteLLM /health 需要 auth header，功能正常） |
| GET /v1/models（无代理） | ✅ 200，返回 claude-sonnet |
| POST /v1/chat/completions（无代理） | ✅ 200，finish_reason=length，cost=$0.000069 |
| GET /health（经 HTTP_PROXY） | ❌ **502 Bad Gateway** ← 根本原因 |

---

## 原因分类

**原因 B：reqwest 默认使用系统代理，`NO_PROXY` 未排除 127.0.0.1。**

LiteLLM 服务本身无问题。App 的 Rust reqwest 客户端读取 `HTTP_PROXY=http://127.0.0.1:7897`，将所有 HTTP 请求（包括回环地址）转发至 Clash 代理，代理无法处理目标为 localhost:4000 的请求，返回 502。

---

## 修复建议（按优先级）

### 方案 1（推荐）：启动 LiteLLM 前设置 NO_PROXY

在启动 LiteLLM 的终端中，临时设置：

```bash
export NO_PROXY="127.0.0.1,localhost"
litellm --config config.yaml --port 4000
```

同时，App（Rust reqwest）侧也需要 `NO_PROXY` 生效。在启动 `npm run tauri dev` 或打开桌面 App 前，也在**同一终端**设置：

```bash
export NO_PROXY="127.0.0.1,localhost"
npm run tauri dev
```

> reqwest 默认读取 `NO_PROXY` 环境变量，设置后 127.0.0.1 的请求将直连，不经过代理。

---

### 方案 2：在 Clash/代理软件中添加 bypass 规则

在 Clash Verge（或其他代理客户端）的设置中，将 `127.0.0.1` 和 `localhost` 加入"代理绕过"或"直连"列表。

Clash Verge 通常在「系统代理」设置里有「绕过域名」字段，添加：

```
127.0.0.1
localhost
::1
```

该方案对所有应用生效，不需要每次设置环境变量。

---

### 方案 3（不推荐）：绕过 App 中的 reqwest 代理

修改 Rust 代码中 reqwest Client 构建，添加 `.no_proxy(...)` 配置。该方案需要修改业务代码，不在本次诊断范围内。

---

## 验证方法

修复后，使用以下命令验证（无需 `--noproxy` 标志，说明系统代理已正确绕过）：

```bash
curl http://127.0.0.1:4000/v1/models -H "Authorization: Bearer sk-local-litellm"
```

应返回 200 及 claude-sonnet 模型列表。

---

## 附：诊断时实际消耗

- 真实 API 调用次数：**1 次**
- 消耗 token：prompt=8, completion=3, total=11
- 费用：**$0.000069**（远低于 $12 预算上限）
