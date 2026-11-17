# Changelog

## 0.1.1

- 按 Obsidian 插件规范调整：设置页去掉顶级 `<h2>`，改用 `setHeading()`。
- 不再访问 `workspace.activeLeaf`，改用 `getMostRecentLeaf()`。
- 生词本写入改用 `vault.process()`，避免与其他插件同时改同一文件时冲突。
- 文档补充：官方提交入口已改为 community.obsidian.md（不再接受 obsidian-releases PR）。

## 0.1.0

- 首次发布。
- Markdown（阅读视图 / 实时预览）与 PDF 文字层划词翻译。
- 支持 Ollama 原生接口与任何 OpenAI 兼容接口，可自动识别、自动读取模型列表。
- 支持 API Key 与自定义请求头（适配要求额外路由头的云端网关）。
- 译文弹窗：复制、重译、拖动、Esc 关闭，可选流式输出。
- 一键加入生词本（callout 条目：原文 / 释义 / 语境 / 来源 + 时间），支持去重、自定义路径与 callout 类型。
- 三条命令与自定义快捷键；连接测试。
