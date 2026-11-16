# AI Local Translator

用**本机运行的模型**做翻译的 Obsidian 插件：在 Markdown 笔记或 PDF 里划词，弹窗里出译文，一键存进生词本。

插件本身不联网，所有请求都发往你自己配置的本地模型服务（Ollama、LM Studio、vLLM、llama.cpp server、one-api 等）。

## 功能

- **划词翻译**：Markdown（阅读视图 / 实时预览）与 PDF 文字层选区均可；默认在选区旁显示一个小按钮，点一下出译文，也可以在设置里改成「选中即翻译」。
- **弹窗阅读**：译文弹窗可拖动，支持复制、重新翻译、Esc 关闭；长文按设置截断，不会一次塞爆上下文。
- **一键生词本**：弹窗里的书签按钮把「原文 / 译文 / 语境句 / 来源笔记 + 时间」写成一条 callout，追加到指定笔记；重复的词会自动跳过。
- **任意本地模型**：OpenAI 兼容接口（`/v1/chat/completions`）与 Ollama 原生接口（`/api/chat`）都支持，可自动识别，也能一键读取本地已安装的模型列表。
- **中文优先**：提示词、报错、界面均为中文，目标语言可在设置里改。

## 安装

### 手动安装

1. 下载/克隆本仓库。
2. 把 `manifest.json`、`main.js`、`styles.css` 放到
   `<你的 Vault>/.obsidian/plugins/ai-local-translator/`。
3. Obsidian → 设置 → 第三方插件 → 关闭「安全模式」→ 刷新已安装插件 → 启用 **AI Local Translator**。

### BRAT

添加 `ai-local-translator` 的 GitHub 仓库地址即可（仓库需包含带 `manifest.json` 的 Release 或根目录文件）。

## 配置

打开 设置 → AI Local Translator：

| 项 | 说明 |
| --- | --- |
| 接口类型 | `自动识别` 会根据端口/路径判断；也可强制指定。 |
| Base URL | Ollama：`http://127.0.0.1:11434`；LM Studio：`http://127.0.0.1:1234/v1`；云端网关填它的 `/v1` 地址。 |
| 模型 | 点右侧刷新按钮读取模型列表，或手动填写（如 `qwen2.5:7b`、`glm-5.3-flash`）。 |
| API Key | 本地服务一般不用；云端网关或带鉴权的代理必填。 |
| 自定义请求头 | 每行一个 `名称: 值`，给要求额外路由头的网关用（如 `x-opencode-session: ...`）。 |
| 温度 | 翻译建议 0 - 0.3。 |
| 超时 | 首次调用时 Ollama 要加载模型，可调大到 120 秒。 |
| 流式输出 | 逐字显示。需要服务端允许跨域，见下方 FAQ；失败会自动退回普通请求。 |
| 目标语言 | 默认中文，替换提示词里的 `{{targetLang}}`。 |
| 提示词 | 可自定义；单词/短语与整段文本会自动追加不同的指令。 |

配置完点「测试」发一次真实请求，确认能通。

### 模型建议

翻译属于短输入短输出任务，7B - 14B 量级的中英双语模型即可（`qwen2.5:7b`、`qwen3:8b`、`gemma3:12b`、`glm4:9b` 等）。
模型太小容易漏译、乱加解释；太大会明显拖慢划词的体验。

## 使用

1. 在笔记或 PDF 里选中文字。
2. 点选区右下角的翻译按钮（或按你给命令绑的快捷键）。
3. 弹窗出来后可：
   - `复制` 图标：复制译文；
   - `书签` 图标：加入生词本；
   - `刷新` 图标：重译。

命令面板里还有：

- `AI Local Translator: 翻译选中文本`
- `AI Local Translator: 翻译选中文本并加入生词本`
- `AI Local Translator: 测试本地模型连接`

快捷键：设置 → 快捷键 → 搜索 `AI Local Translator` 自行绑定（建议 `Ctrl/Cmd + Alt + T`）。

> PDF 说明：只对**带文字层**的 PDF 有效。扫描版（图片型）PDF 选中不到文字，需要先 OCR。

## 生词本格式

默认写入 `生词本.md`（不存在会创建），每条是一个 callout：

```markdown
> [!tip] abandon
> **释义**：vt. 放弃；抛弃；遗弃
> **语境**：He abandoned the plan after the first failure.
> **来源**：[[某篇笔记]] · 2026-11-16 15:20
```

- 路径、callout 类型（`tip`/`note`/`info`/`quote`…）、是否记录语境和来源、语境截断长度、是否去重都能在设置里改。
- 追加在文件末尾（最新在最后）；配合 Dataview 很容易做复习表。

## 常见问题

**Q：弹窗提示「无法连接到 http://...」**
A：先确认本地服务在跑（浏览器打开 `http://127.0.0.1:11434` 或 `http://127.0.0.1:1234/v1/models` 试试），再确认 Base URL 端口正确。

**Q：报 HTTP 404**
A：路径不对。OpenAI 兼容服务一般要 `/v1` 后缀，Ollama 用根地址。把接口类型改成「自动识别」并检查 URL。

**Q：开了流式输出没反应 / 报错**
A：Electron 的 `fetch` 受 CORS 限制。Ollama 需要先设环境变量再重启：

```bash
# Windows (PowerShell)
setx OLLAMA_ORIGINS "*"
# macOS / Linux
export OLLAMA_ORIGINS="*"
```

LM Studio 在 Server 设置里勾选 "Enable CORS" 即可。设置失败也没关系：插件会自动退回非流式请求，只是没有逐字效果。

**Q：PDF 选中不了 / 没有按钮**
A：确认 PDF 有文字层；确认设置里「PDF 划词翻译」是开的；某些 PDF 阅读器类插件会接管选区事件，可临时关掉排查。

**Q：还没有装本地模型，能先看看效果吗？**
A：可以。仓库里带了一个假模型服务：

```bash
node tools/mock-server.js
```

然后在插件设置里填 Base URL `http://127.0.0.1:8787/v1`、模型 `mock-model`，就能走通划词 → 弹窗 → 生词本的完整流程（译文是「【模拟译文】+ 反转原文」）。它同时实现了 OpenAI 与 Ollama 两套接口，含流式，用来验证配置很方便。

**Q：会不会把我的笔记发到云端？**
A：不会。插件只请求你在设置里填的那个地址，没有任何遥测。

## 开发

这个插件**没有构建步骤**：`main.js` 就是可直接加载的 CommonJS 源码。

- 仓库（开发与发布）：本目录
- Vault 里的安装副本：`<Vault>/.obsidian/plugins/ai-local-translator/`

改完代码后同步进 vault：

```bash
node tools/install-to-vault.js                       # 默认装到 D:\projects\O_Vault
node tools/install-to-vault.js "D:\OtherVault"       # 指定别的 vault
```

然后在 Obsidian 里 `Ctrl+R` 重载（或在设置里关开一次插件）。

```
obsidian-ai-local-translator/
├─ manifest.json
├─ versions.json
├─ main.js                  # 插件本体（无需打包）
├─ styles.css
├─ test/smoke.js            # 无头冒烟测试（stub 掉 obsidian + DOM）
├─ tools/mock-server.js     # 假模型服务，没装 LLM 时也能验证 UI
├─ tools/install-to-vault.js
└─ PUBLISH.md               # 上架官方市场的完整清单
```

跑测试（20 个用例：接口拼装、SSE / NDJSON 解析、选区识别、生词本写入、设置页渲染）：

```bash
node test/smoke.js
```

发布前要改的地方：`manifest.json` 里的 `author` / `authorUrl` 填你自己的 GitHub 信息。上架步骤见 [PUBLISH.md](PUBLISH.md)。

## English

AI Local Translator translates selected text in Markdown notes and PDFs using a model running on your own machine — Ollama, LM Studio, vLLM, llama.cpp server or any OpenAI-compatible endpoint. A floating button appears next to the selection; the popup shows the translation, lets you copy it, retranslate it, or save it to a vocabulary note as a callout (`term / translation / context / source`). Nothing leaves your machine.

## License

MIT
