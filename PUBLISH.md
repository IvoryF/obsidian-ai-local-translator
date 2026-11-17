# 上架官方社区插件目录

> **2025 年后流程变了**：`obsidianmd/obsidian-releases` 已不再接受 PR（该仓库 PR 通道关闭，`community-plugins.json` 由官方系统生成）。现在统一在 **community.obsidian.md** 提交，需要你的 Obsidian 账号 + 关联 GitHub。

仓库、Release、manifest 都已经备好，剩下的是在网页上点几个按钮。

## 0. 元信息（已完成）

```json
"id": "ai-local-translator",
"author": "IvoryF",
"authorUrl": "https://github.com/IvoryF",
"minAppVersion": "1.5.0"
```

`id` 全站唯一、不能包含 `obsidian`，上架后**不可更改**。

## 1. 仓库（已完成）

https://github.com/IvoryF/obsidian-ai-local-translator

## 2. 发 Release

规则：**tag == `manifest.json` 的 `version`**，不带 `v` 前缀；资产是三个独立文件（不是 zip）。

```bash
git tag -a 0.1.1 -m "0.1.1"
git push origin 0.1.1
```

然后 GitHub → Releases → Draft a new release：Tag 选 `0.1.1`，标题 `0.1.1`，附件拖入 `main.js`、`manifest.json`、`styles.css`。

## 3. 提交到社区目录

1. 打开 https://community.obsidian.md ，用 **Obsidian 账号**登录。
2. 在个人资料里**关联 GitHub 账号**（用于验证仓库归属）。
3. **Add your plugin**，填入仓库 `IvoryF/obsidian-ai-local-translator`。
4. 系统会读默认分支 HEAD 上的 `manifest.json`，并核对 Release（tag 是否等于 version、资产是否齐全）。
5. 自动审核会给出待修项。改完 → 提版本 → 发新 Release 即可，不用重新走提交入口。

> 提交前确保 `git push` 完成：目录读的是 GitHub 上的 HEAD，不是你本地文件。

## 4. 自动审核常见问题（已自查）

| 检查项 | 状态 |
| --- | --- |
| `manifest.json` 字段完整、`id` 唯一 | ✅ |
| README / LICENSE 在仓库根目录 | ✅ |
| Release 资产为 `main.js`、`manifest.json`、`styles.css` | ✅ |
| tag 与 version 一致（无 `v`） | ✅ |
| 不使用 `innerHTML` / `eval` / 远程代码 | ✅ 仅 `createEl`/`textContent` |
| 无 `console.log` 噪音 | ✅ |
| 使用 `this.app` 而非全局 `app` | ✅ |
| 不直接访问 `workspace.activeLeaf` | ✅ 用 `getMostRecentLeaf()` |
| 不设默认热键 | ✅ |
| 设置页不用 `<h1>`/`<h2>` 顶级标题 | ✅ 全部 `setHeading()` |
| 后台改文件用 `vault.process()` | ✅ |
| 路径统一 `normalizePath()` | ✅ |
| 无遥测、只在用户划词后请求 | ✅ |

## 5. 后续版本发布

1. 改 `manifest.json` 的 `version`，在 `versions.json` 里加一条 `"新版本": "最低 Obsidian 版本"`。
2. 更新 `CHANGELOG.md`。
3. 打同名 tag、发 Release、上传三个文件。
4. **不用**再碰 community 后台：插件已在目录里，用户会直接从新 Release 安装。
