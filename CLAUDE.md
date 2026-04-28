# TCM Knowledge Engine — Claude Code 工程规范

## 项目目标

面向中西医结合学习者（医学生、住院医师、执业医师）的中医知识采集与管理系统。

目标：将非结构化中医文本（教材、论文、医案）通过 AI 结构化为实体-关系知识图谱，支持医生的知识管理与临床思维训练。

**定位：教育与知识管理工具，不提供诊断建议，不替代临床决策。**

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 19 + TypeScript + Vite |
| 桌面壳 | Tauri 2（Rust 后端） |
| 本地数据库 | SQLite（通过 Tauri Rust 命令访问） |
| 前后端通信 | `@tauri-apps/api` `invoke()` IPC |
| UI 组件 | lucide-react 图标库 |
| AI 接入 | 可配置 OpenAI-compatible API（存储于 SQLite，密钥加密） |
| 构建工具 | Vite + rolldown |
| 类型检查 | TypeScript strict 模式 |

**Rust 后端**（`src-tauri/`）处理：SQLite 读写、AI API 请求、密钥存储。

**前端**（`src/`）只通过 `invoke()` 调用 Tauri 命令，不直接访问系统资源。

---

## 目录结构

```txt
tcm-knowledge-engine-mvp/
├── src/                         # React 前端
│   ├── App.tsx                  # 路由入口
│   ├── main.tsx                 # React 挂载
│   ├── components/
│   │   └── Sidebar.tsx          # 导航侧边栏
│   ├── pages/
│   │   ├── Dashboard.tsx        # 主页仪表盘
│   │   ├── IngestionPage.tsx    # 知识采集入口
│   │   ├── ReviewPage.tsx       # AI 结构化结果审核
│   │   ├── KnowledgePage.tsx    # 知识库实体列表与详情
│   │   ├── GraphPage.tsx        # 知识图谱可视化
│   │   └── ModelSettingsPage.tsx # AI 模型配置
│   ├── lib/
│   │   ├── api.ts               # Tauri invoke 封装（前端唯一 IPC 层）
│   │   ├── aiProcessor.ts       # AI 处理入口（前端侧）
│   │   └── types.ts             # 全局 TypeScript 类型
│   └── prompts/                 # AI Prompt 模板（Markdown）
│       ├── case_prompt.md
│       ├── general_structure_prompt.md
│       └── paper_prompt.md
├── src-tauri/                   # Rust 后端
│   ├── src/main.rs              # Tauri 入口
│   └── tauri.conf.json          # Tauri 配置
├── docs/
│   ├── ARCHITECTURE.md
│   ├── ROADMAP.md
│   └── SQLITE_INGESTION_PLAN.md
├── .claude/
│   ├── agents/                  # Subagent 定义
│   ├── commands/                # Slash commands
│   └── settings.local.json      # 本地权限配置，不建议提交
└── CLAUDE.md                    # 本文件
```

---

## 开发规则

1. **前端不访问系统资源**：文件系统、网络、数据库操作必须通过 Tauri `invoke()` 在 Rust 侧完成。
2. **TypeScript strict**：不使用 `any`、`ts-ignore`、`@ts-nocheck`，类型问题必须正确修复。
3. **最小化修改**：只改任务要求的代码，不做额外重构或清理。
4. **IPC 类型一致**：`src/lib/types.ts` 中的接口必须与 Rust 命令返回结构严格对应。
5. **AI 输出仅为参考**：所有 AI 生成的实体、关系、中西对照均需标注 confidence，保留可回溯来源。
6. **无破坏性操作**：不执行 `git reset --hard`、`rm -rf`、删除数据库等操作，除非用户明确要求。
7. **配置与业务代码分离**：修改 `.claude/`、`CLAUDE.md`、文档时，不得顺手修改业务代码。
8. **小步提交**：优先保持变更小、可审查、可回滚。
9. **先理解后修改**：修改代码前必须先阅读相关文件，不得凭猜测重写。
10. **保持项目结构一致**：新增文件必须遵循现有目录职责，不得随意创建重复模块。

---

## 医学内容安全边界

- 所有 AI 输出的中医知识结构化结果**必须标记为教育参考，不作为诊断或治疗依据**。
- 中西医对照映射必须标注 `mapping_level`，例如：
  - `established`
  - `reasonable_inference`
  - `hypothesis`
  - `uncertain`
- 不得以确定性语气描述未经验证的中西医机制假说。
- 不得向用户暗示本系统可替代医生诊断。
- AI Review 结果（如 `level: A/B/C`、`decision`）是知识质量标签，不是临床建议。
- 医案数据属于敏感个人健康信息，不得外传或写入日志。
- 涉及用药、方剂、证候推理、病案解析时，必须保留来源、置信度与人工审核入口。
- 对任何具有临床风险的内容，应优先使用“知识管理参考”“学习材料”“待人工审核”等表述。

---

## API Key 与隐私安全规则

- **API Key 绝对禁止**出现在以下位置：
  - 源代码
  - 日志
  - README
  - Git 提交历史
  - 前端代码
  - LocalStorage
  - Console 输出
  - 错误提示
- API Key 存储在 SQLite 加密字段，仅 Rust 后端可读取。
- 前端接口只能返回 `maskedApiKey`，例如：`sk-...xxxx`。
- `.env` 文件被 Claude Code 权限系统拒绝读取，不得绕过。
- 任何涉及 API Key 的代码变更必须调用 `security-reviewer`。
- 用户输入文本（医案、症状描述、病史材料）属于敏感数据，不得写入明文日志。
- 不得将用户敏感内容发送到未配置、未授权或未知的第三方服务。
- 不得在错误信息、调试输出、console、Rust 日志中输出完整 API Key 或原始敏感病案文本。
- 涉及 AI provider、模型配置、Base URL、API Key 测试连接的功能，必须优先考虑隐私和密钥隔离。

---

## 常用验证命令

```bash
# 前端类型检查与构建
npm run build

# Rust 编译检查
cargo check --manifest-path src-tauri/Cargo.toml

# Rust 格式检查
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check

# 开发模式（前端热重载）
npm run dev

# 桌面端调试
npm run tauri dev
```

---

## 验证命令执行规则

对于**非 trivial 代码修改**，完成前必须至少运行：

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

如果修改涉及 Rust 格式或 Rust 后端逻辑，还应运行：

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

对于以下任务，可以不运行完整构建，但必须在最终回复中说明原因：

- 仅修改 `CLAUDE.md`
- 仅修改 `.claude/agents/`
- 仅修改 `.claude/commands/`
- 仅修改文档
- 仅修改注释
- 仅修改 Prompt 模板
- 仅进行代码阅读、架构分析、问题定位，未改业务代码

不得在未运行必要验证命令的情况下宣称代码修改已完成。

如果验证命令失败，必须：

1. 报告失败命令。
2. 摘要说明错误。
3. 定位根因。
4. 给出最小修复方案。
5. 不得通过 `any`、`ts-ignore`、关闭 lint、删除测试来掩盖错误。

---

## Agent 调用规则

| 场景 | 必须调用的 Agent |
|---|---|
| 任何非 trivial 代码修改 | `code-quality-reviewer` |
| 涉及测试、构建、回归风险 | `test-engineer` |
| 涉及 API Key、用户数据、SQLite、环境变量、IPC 接口 | `security-reviewer` |
| 涉及中医知识结构、医学内容、AI 结构化输出 | `tcm-product-reviewer` |
| 新功能开发 | 先 `code-quality-reviewer`，再按需调用其他 reviewer |

---

## Agent 使用原则

- Agent 用于审查、定位问题、提出建议，不应替代必要的构建验证。
- 对于配置、文档、Prompt 变更，可只调用相关 reviewer 或说明无需调用的理由。
- 不能在未运行必要验证命令并调用相关 agent 的情况下宣称非 trivial 代码任务完成。
- 如果 agent 给出 blocking issue，必须修复或明确向用户说明为何暂不修复。
- Agent 审查结论必须在最终回复中摘要说明。
- 不得让 reviewer 直接进行大范围业务代码重构，除非用户明确要求。

---

## Slash Command 使用规则

项目内常用命令：

| 命令 | 用途 |
|---|---|
| `/review` | 对当前变更做综合审查 |
| `/fix-build` | 定位并修复构建、类型、编译错误 |
| `/create-feature` | 新功能开发流程：理解 → 计划 → 确认 → 实现 → 验证 |
| `/security-check` | 只做安全检查，不修改代码 |

使用原则：

- 大功能开发前优先使用 `/create-feature`。
- 代码修改完成后优先使用 `/review`。
- 构建失败时使用 `/fix-build`。
- `/fix-build` 不得通过 `any`、`ts-ignore`、关闭 lint 或删除测试掩盖错误。
- 涉及 API Key、隐私、医案、SQLite、IPC 的变更，应使用 `/security-check` 或调用 `security-reviewer`。
- Slash command 不应绕过 `CLAUDE.md` 中的项目规则。

---

## 新功能开发流程

新功能必须按以下流程执行：

1. **理解阶段**
   - 阅读 `CLAUDE.md`
   - 阅读相关源码
   - 总结现有实现
   - 不修改文件

2. **计划阶段**
   - 给出实现计划
   - 列出拟修改文件
   - 说明数据流与架构影响
   - 说明风险点
   - 等待用户确认

3. **实现阶段**
   - 小步修改
   - 保持最小变更
   - 不改无关文件
   - 不新增依赖，除非说明理由并获得确认

4. **验证阶段**
   - 运行必要验证命令
   - 如失败，定位根因并修复
   - 不绕过类型系统或构建错误

5. **审查阶段**
   - 调用相关 agent
   - 汇总 blocking issues
   - 修复必要问题

6. **汇报阶段**
   - 使用本文件规定的 Final Response 格式

---

## Bug 修复流程

修复 bug 时必须遵循：

1. 先复现或解释如何复现。
2. 先定位根因，不直接打补丁。
3. 优先最小修复。
4. 不做无关重构。
5. 修复后运行相关验证命令。
6. 说明为什么该修复不会破坏其他功能。
7. 如果无法完全验证，必须明确说明剩余风险。

禁止：

- 未定位根因就大面积改代码。
- 用 `any`、`ts-ignore`、异常吞噬来隐藏问题。
- 删除失败测试或跳过检查。
- 修改与 bug 无关的 UI、文案、架构。

---

## UI 修改规则

涉及 UI 修改时：

- 保持医学知识库风格：专业、清晰、克制。
- 避免过度花哨、儿童化、游戏化视觉。
- 优先提升信息层级、可读性、检索效率。
- 避免大面积重写组件。
- 修改交互逻辑时必须说明用户路径。
- 如果涉及模型配置、API Key、AI 输出，应优先显示明确状态与错误信息，但不得泄露密钥。
- 医学内容展示应保留来源、置信度、人工审核状态。

---

## AI 模型配置规则

涉及 AI provider、模型、Base URL、API Key 测试连接时：

- 前端不得直接持有完整 API Key。
- 测试连接应由 Rust 后端执行。
- 错误信息应可读，但不得包含完整密钥。
- 支持用户自定义 provider、baseUrl、modelName。
- 模型配置变更必须经过 `security-reviewer`。
- 不得把开发者个人使用的 OpenRouter、Anthropic、代理端口、Shell 环境变量写入项目代码或文档。
- 任何日志输出必须脱敏。

---

## Final Response 格式

每次任务完成后，输出格式如下：

```md
## 完成报告

**修改的文件：**
- `path/to/file.ts` — 修改说明

**验证结果：**
- `npm run build` — ✅ 通过 / ❌ 失败（错误信息）/ 未运行（原因）
- `cargo check --manifest-path src-tauri/Cargo.toml` — ✅ 通过 / ❌ 失败（错误信息）/ 未运行（原因）

**Agent 审查结论：**
- code-quality-reviewer：[结论摘要 / 未调用原因]
- security-reviewer（如涉及）：[结论摘要 / 未调用原因]
- test-engineer（如涉及）：[结论摘要 / 未调用原因]
- tcm-product-reviewer（如涉及）：[结论摘要 / 未调用原因]

**未修改业务代码确认：**
- ✅ 是 / ❌ 否，说明原因

**剩余风险：**
- [如无则写“暂无已知风险”]

**下一步建议：**
[1-2 句话]
```

---

## 常见禁止行为

- 用 `any`、`ts-ignore`、`@ts-nocheck` 掩盖类型错误。
- 关闭 lint 或删除测试来让构建通过。
- 将 API Key 写入代码、日志、README 或 Git 提交。
- 在未运行必要验证命令的情况下宣称代码修改完成。
- 未经用户确认执行破坏性 Git 操作，例如：
  - `git reset --hard`
  - `git push --force`
  - `git clean -fd`
  - 删除数据库文件
- 对外宣称本系统提供医疗诊断能力。
- 在 AI 输出中以确定性语气描述未经验证的中西医机制映射。
- 绕过 `.claude/settings.local.json` 中的 `deny` 规则。
- 在前端代码中直接访问文件系统或网络，必须通过 Tauri IPC。
- 修改业务代码却不告知用户并等待确认，尤其是非 trivial 变更。
- 在非必要情况下新增依赖。
- 在没有解释原因的情况下大范围重构。
- 把本地个人配置、密钥、机器路径写入可提交文件。
- 把 OpenRouter Key、Anthropic Key、代理端口、VPN 配置写入项目文件。
- 把调试过程中的个人环境变量写入业务代码。
- 将用户医案、症状描述、病史材料写入日志或测试快照。

---

## Git 与提交规则

- 提交前必须运行：

```bash
git status
git diff --stat
```

- 提交前必须确认没有以下内容被加入：
  - `.env`
  - API Key
  - 数据库文件
  - 构建产物
  - 个人本地配置
  - 代理配置
  - 机器路径
  - 明文医案或敏感用户数据

- `.claude/settings.local.json` 属于本地设置，默认不建议提交。
- 每个 commit 应对应一个清晰目标，不要把无关变更混在一起。
- 生成 commit message 前，先总结 diff，不要直接提交，除非用户明确要求。
- 如果用户要求提交，先展示拟提交文件列表和 commit message。
- 不得自动执行 `git push`，除非用户明确要求。

---

## Claude Code 行为规则

- 修改前先理解相关文件，不要凭猜测重写。
- 大任务先计划，得到用户确认后再改。
- 小任务可以直接执行，但仍需保持最小修改。
- 遇到构建失败，先定位根因，不要绕过错误。
- 对于不确定的技术栈、命令、接口，先读取项目文件确认。
- 不要将模型 API Key、OpenRouter Key、Anthropic Key、代理配置写入项目文件。
- 不要把用户本机路径、代理端口、个人环境变量写进业务代码。
- 不要因为 reviewer 建议而自动扩大任务范围。
- 如果任务目标不清楚，先提出最小必要澄清问题。
- 如果发现安全风险，应立即停止相关实现并报告。
- 如果发现现有项目结构与本文件描述不一致，应以实际代码为准，并建议更新本文件。

---

## 本地配置提醒

以下内容属于个人环境，不应写入业务代码或提交到仓库：

- OpenRouter API Key
- Anthropic API Key
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- Clash Verge 代理端口
- VPN 节点信息
- 本机绝对路径
- 个人 Shell 启动脚本
- `.env`
- `.claude/settings.local.json`

如果需要记录通用配置方式，应写入文档，并使用占位符，例如：

```txt
ANTHROPIC_BASE_URL=https://openrouter.ai/api
ANTHROPIC_AUTH_TOKEN=your_api_key_here
```

不得写入真实密钥。

---

## 项目特殊注意事项

本项目是中医知识管理与中西医结合知识结构化系统，不是普通笔记软件。

开发时应始终关注：

- 知识结构是否支持“病、证、症、方、药、法、经络、医案、机制、证据”的关系组织。
- AI 输出是否可追溯。
- 医学内容是否可人工审核。
- 用户是否能区分“原文事实”“AI 推断”“人工确认”。
- 中西医映射是否避免过度确定化。
- 产品是否服务于医生学习、知识整理和临床思维训练，而不是替代诊疗。

---