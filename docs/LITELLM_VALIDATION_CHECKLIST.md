# LiteLLM 接入验证清单

**日期：2026-04-28 | 预算上限：$12**

> 按顺序执行，遇到失败立即截图并停止，不要反复重试消耗预算。

---

## 步骤 1：启动 LiteLLM Proxy

```bash
cd tcm-knowledge-engine-mvp/litellm
litellm --config config.yaml --port 4000
```

- [ ] 终端显示 `Uvicorn running on http://0.0.0.0:4000`
- [ ] 无报错输出

---

## 步骤 2：App 新建 LiteLLM 模型配置

在「模型设置」页面新增：

| 字段 | 值 |
|------|----|
| Provider 名称 | LiteLLM Local |
| Base URL | `http://127.0.0.1:4000` |
| API Key | `sk-local-litellm` |
| Model Name | `claude-sonnet` |
| API Type | `chat_completions` |

- [ ] 保存成功
- [ ] 点击「设为当前」，配置显示为激活状态

---

## 步骤 3：测试连接

- [ ] 点击「测试连接」
- [ ] 返回「连接成功」及延迟毫秒数
- [ ] 如失败：检查 LiteLLM 终端是否有报错，确认 Base URL 未加 `/v1`

---

## 步骤 4：短文本 AI 结构化

在「采集任务」页粘贴以下测试文本（约 50 字）：

> 麻黄汤由麻黄、桂枝、杏仁、炙甘草组成，主治太阳伤寒表实证，症见恶寒发热、无汗而喘。

- [ ] 点击「开始 AI 结构化」
- [ ] 结果页出现 entities 列表
- [ ] 无 JSON 截断错误
- [ ] 记录「AI 用量统计」：totalCalls = ___ / totalCostUsd = ___

---

## 步骤 5：相同文本二次结构化（验证 App exact cache）

- [ ] 不修改文本，再次点击「开始 AI 结构化」
- [ ] 返回相同结果，速度明显更快（命中本地 SQLite cache）
- [ ] 「AI 用量统计」中 cacheHitCount +1，totalCostUsd **不变**
- [ ] LiteLLM 终端**无新请求日志**（App 直接返回缓存，不经过 LiteLLM）

---

## 步骤 6：核对 OpenRouter 后台费用

- [ ] 登录 OpenRouter 控制台 → Usage
- [ ] 上述两次调用只产生 **1 次**实际 API 请求
- [ ] 如显示 2 次，说明 App cache 未命中，截图后停止

---

## 步骤 7：502 Bad Gateway 排查

如步骤 3「测试连接」返回 502，按以下顺序排查：

### 7a. 确认 LiteLLM 本身正常

用绕过代理的方式直接请求（PowerShell）：

```powershell
curl.exe --noproxy "127.0.0.1,localhost" http://127.0.0.1:4000/v1/models `
  -H "Authorization: Bearer sk-local-litellm"
```

- [ ] 返回 200 及 claude-sonnet 模型列表 → LiteLLM 正常，问题在代理
- [ ] 返回 connection refused → LiteLLM 未启动，重新执行步骤 1

### 7b. 检查 NO_PROXY

在 PowerShell 中：

```powershell
$env:NO_PROXY
$env:no_proxy
```

- [ ] 两者均包含 `127.0.0.1` 和 `localhost` → 正常
- [ ] 为空或未包含 → 执行以下命令后**重新启动 App 和 LiteLLM**：

```powershell
$env:NO_PROXY="127.0.0.1,localhost,::1"
$env:no_proxy="127.0.0.1,localhost,::1"
```

### 7c. 检查代理软件直连规则

在 Clash Verge（或其他代理客户端）规则列表中确认以下规则存在：

```
DOMAIN,localhost,DIRECT
IP-CIDR,127.0.0.1/32,DIRECT
IP-CIDR,::1/128,DIRECT
```

- [ ] 规则存在 → 代理软件已正确绕过 localhost
- [ ] 规则缺失 → 添加后重试步骤 3

### 7d. 再次测试连接

- [ ] 重新点击「测试连接」，返回成功

> **注意：** 502 确认为代理问题后，**停止反复点击「测试连接」**，每次点击都会产生一个被代理拦截的失败请求，不会自动恢复。修复代理配置或 NO_PROXY 后再重试一次即可。

---

## 失败处理原则

- 遇到错误 → 截图 → 停止，不要反复重试
- **不要在未确认 NO_PROXY 正确的情况下反复点击「测试连接」**
- 检查 LiteLLM 终端日志，不要修改 Rust 代码来调试
- 如 LiteLLM 报 401：检查 `litellm/.env` 中 `OPENROUTER_API_KEY` 是否正确填写
- 如 App 报 connection refused：确认 LiteLLM 进程仍在运行，端口为 4000
- 如 App 报 502：参考步骤 7，根因几乎必然是系统代理拦截 localhost
