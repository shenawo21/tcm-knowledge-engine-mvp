# LiteLLM 本地代理接入指南

**适用场景：** 在本地运行 LiteLLM Proxy，再由 App 通过 `http://127.0.0.1:4000` 访问 Claude Sonnet 4.6（经由 OpenRouter）。

> **注意：** 此为可选阶段。直连 OpenRouter 已完全可用；LiteLLM 仅用于本地日志、限速等附加能力。

---

## 一、安装 LiteLLM

```bash
pip install litellm[proxy]
# 验证安装
litellm --version
```

---

## 二、准备配置文件

```bash
cd tcm-knowledge-engine-mvp/litellm

# 复制示例配置（config.yaml 不提交到仓库）
cp config.example.yaml config.yaml

# 复制示例环境变量
cp .env.example .env
```

编辑 `litellm/.env`，填入真实值：

```
OPENROUTER_API_KEY=<你的 OpenRouter Key>
LITELLM_MASTER_KEY=sk-local-litellm
```

> **安全提示：** 不要将真实 Key 写入任何可提交的文件（config.yaml、README、代码等）。

---

## 三、Windows 代理注意事项（重要）

**若本机运行了 Clash、VPN 或其他代理软件，必须先配置 localhost 直连，否则 App 请求会返回 502。**

### 方法 A：启动前在 PowerShell 设置 NO_PROXY

在启动 LiteLLM 和 App 的同一个 PowerShell 终端中执行：

```powershell
$env:NO_PROXY="127.0.0.1,localhost,::1"
$env:no_proxy="127.0.0.1,localhost,::1"
```

然后在**同一终端**启动 LiteLLM 和 `npm run tauri dev`，两者都会继承该环境变量。

> reqwest（App 的 Rust HTTP 客户端）默认读取 `NO_PROXY`，设置后 127.0.0.1 的请求将直连。

### 方法 B：在代理软件中添加直连规则（推荐，一劳永逸）

在 Clash Verge 或其他代理客户端的规则列表中添加：

```
DOMAIN,localhost,DIRECT
IP-CIDR,127.0.0.1/32,DIRECT
IP-CIDR,::1/128,DIRECT
```

配置后所有应用的 localhost 请求均直连，无需每次设置环境变量。

---

## 四、启动 LiteLLM Proxy

```bash
cd tcm-knowledge-engine-mvp/litellm
litellm --config config.yaml --port 4000
```

成功启动后终端会显示：
```
LiteLLM: Proxy initialized with model: claude-sonnet
INFO:     Uvicorn running on http://0.0.0.0:4000
```

---

## 五、App 模型配置填写

在「模型设置」页面新增配置：

| 字段 | 值 |
|------|----|
| Provider 名称 | LiteLLM Local |
| **Base URL** | `http://127.0.0.1:4000` |
| API Key | `sk-local-litellm` |
| **Model Name** | `claude-sonnet` |
| API Type | `chat_completions` |

> **Base URL 说明：** App 内的 `build_endpoint_url()` 会自动拼接 `/v1/chat/completions`，
> 因此 Base URL **不要** 写 `/v1`，填 `http://127.0.0.1:4000` 即可。
> 最终请求地址为 `http://127.0.0.1:4000/v1/chat/completions`。

填写后点击「保存」→「设为当前」→「测试连接」，确认返回成功。

---

## 六、验证接入

详见 `docs/LITELLM_VALIDATION_CHECKLIST.md`。

---

## 七、停止代理

在 LiteLLM 终端窗口按 `Ctrl+C`。App 可切回 OpenRouter 直连配置继续使用。

---

## 八、不做的事项

- 不配置 Redis 缓存（exact cache 在 App 的 SQLite 中）
- 不配置 fallback 或多模型路由
- 不配置 Langfuse / Helicone
- 不开放外网端口（仅本机 127.0.0.1）
