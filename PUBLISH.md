# 上架官方插件市场（obsidian-releases）

> 这一步需要你本人的 GitHub 账号：仓库归你、Release 由你打、PR 由你提交。下面是完整清单，照着做即可。

## 0. 先补两个字段

`manifest.json` 里现在是占位符，提交前必须换成你自己的信息：

```json
"author": "你的 GitHub 用户名",
"authorUrl": "https://github.com/你的用户名"
```

`id`（`ai-local-translator`）一旦上架**不能改**，它会成为插件的永久标识。

## 1. 建仓库并推送

仓库就在 `D:\projects\obsidian-ai-local-translator`（已经 `git init` 并有一次提交）：

```bash
cd D:\projects\obsidian-ai-local-translator
git remote add origin https://github.com/<你>/obsidian-ai-local-translator.git
git push -u origin main
```

仓库建议命名 `obsidian-ai-local-translator`（Obsidian 不强制，但社区习惯这样）。

## 2. 打 tag 并发布 Release

tag **必须**和 `manifest.json` 里的 `version` 完全一致，**不带 `v` 前缀**：

```bash
git tag -a 0.1.0 -m "0.1.0"
git push origin 0.1.0
```

然后在 GitHub → Releases → Draft a new release：

- Tag：`0.1.0`（选刚推的 tag）
- Title：`0.1.0`
- 上传附件（拖进去即可）：`main.js`、`manifest.json`、`styles.css`

这三个文件是 Obsidian 安装 / BRAT 更新时抓取的资产，缺 `main.js` 或 `manifest.json` 会被审核退回。

## 3. 提交 PR 到 obsidian-releases

1. Fork https://github.com/obsidianmd/obsidian-releases
2. 编辑根目录的 `community-plugins.json`，在末尾（保持大致字母序即可）追加：

```json
	{
		"id": "ai-local-translator",
		"name": "AI Local Translator",
		"author": "<你的名字>",
		"description": "Translate selected text in Markdown notes and PDFs with a locally running model; save words to a vocabulary note.",
		"repo": "<你>/obsidian-ai-local-translator"
	},
```

3. 开 PR，标题：`Add plugin: AI Local Translator`
4. PR 描述可以直接用：

```markdown
# I am submitting a new Community Plugin

## Repo URL
https://github.com/<你>/obsidian-ai-local-translator

## Release Checklist
- [x] I have tested the plugin on Windows
- [x] My GitHub release contains all required files: `main.js`, `manifest.json`, `styles.css`
- [x] GitHub release name matches the exact version number specified in `manifest.json` (0.1.0)
- [x] The `id` in my `manifest.json` matches the `id` in `community-plugins.json`
- [x] My README.md describes the plugin's purpose and provides clear usage instructions
- [x] I have read the developer policies and my plugin follows them
- [x] I have added a LICENSE
- [x] The plugin does not send any data to third parties; all requests go to the user's own local model endpoint
```

## 4. 审核常见退回原因（自查）

- `manifest.json` 的 `id` 与其他插件重复、或与 `community-plugins.json` 不一致。
- Release 的 tag 写成 `v0.1.0`（必须 `0.1.0`），或 tag 与 `version` 不一致。
- 缺少 `main.js` / `manifest.json` 附件，或只上传了 zip。
- 使用 `innerHTML` / `eval` / 动态加载远程代码（本插件均未使用）。
- `console.log` 满屏（本插件无日志输出）。
- README 没有说明怎么配置本地模型（本插件已写）。
- 插件启动时无提示地联网（本插件只在用户划词后才发请求）。

审核周期通常几天到一两周。合并后约 1 天内会出现在社区插件列表里（按 `id` 搜索 "AI Local Translator"）。

## 5. 后续版本发布

1. 改 `manifest.json` 的 `version`，并在 `versions.json` 里加一条 `"新版本": "最低 Obsidian 版本"`。
2. 更新 `CHANGELOG.md`。
3. 打同名 tag、发布 Release、上传三个文件。
4. **不需要**再提 PR；市场会按已有条目自动读取新 Release。
