# TCM Knowledge Engine MVP

面向中西医结合学习者的中医知识采集、AI结构化、知识图谱与学习系统 MVP。

## 当前版本范围

- Windows 优先的 Tauri + React 桌面客户端骨架
- 采集任务页面
- AI结构化结果页面
- 知识库详情页面
- 知识图谱页面
- SQLite 数据库 Schema
- AI Prompt 模板
- 后续多端扩展预留

## 技术栈

- Frontend: React + TypeScript + Vite
- Desktop Shell: Tauri
- Local DB: SQLite
- Graph UI: 可后续接入 Cytoscape.js / React Flow
- AI: 预留 OpenAI API / 本地模型接口

## 启动方式

```bash
npm install
npm run dev
```

桌面端：

```bash
npm run tauri dev
```

> 注意：此包是 MVP 工程骨架。你需要本地安装 Node.js、Rust、Tauri CLI。
