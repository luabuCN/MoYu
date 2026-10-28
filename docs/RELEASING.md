# 提交、构建与发布

仓库：<https://github.com/luabuCN/MoYu>。

## 每次推送自动发布

`.github/workflows/release.yml` 在每次分支推送和手动运行时构建三个安装包。所有构建成功后，发布任务生成 `SHA256SUMS.txt`、`build-info.json`，上传全部文件，再发布 Release。某个平台失败时不发布新的 Release，可在 Actions 页面重跑失败任务。

| 运行环境 | 架构 | 产物 |
| --- | --- | --- |
| Windows Server 2022 | x64 | `MoYu-版本-windows-x64-setup.exe`，NSIS 安装向导 |
| macOS 15 / Apple Silicon | arm64 | `MoYu-版本-macos-arm64.dmg` |
| macOS 15 / Intel | x64 | `MoYu-版本-macos-x64.dmg` |

普通推送生成独立的 `build-运行编号-提交短哈希` 预发布版，不覆盖正式版的 Latest。一次推送包含多个提交时，构建的是该次推送的最后一个提交。仅在本机执行 `git commit` 不会触发 GitHub，必须 `git push`。

推送 `v1.6.0` 这样的版本标签时生成正式 Release，并设为 Latest。标签必须等于 `v` 加上 `package.json` 的版本；带 `-beta.1` 等后缀的版本仍为预发布。

## 首次连接仓库

项目已有 `.git` 时先运行 `git status`，跳过初始化。还没有 Git 仓库时，在项目根目录执行：

```sh
git init -b main
git remote add origin https://github.com/luabuCN/MoYu.git
git fetch origin main
git pull --no-rebase --allow-unrelated-histories origin main
```

远程已有文件时应先处理同名文件差异，保留远程历史，不使用强制推送。提交前可运行 `git status --short` 检查文件。

配置 Git 身份后，使用提交脚本：

```sh
npm run submit -- "feat: 增加阅读功能"
```

脚本会暂存修改、创建提交并推送当前分支。若 GitHub 身份验证失败，按 Git 的提示登录后重试 `git push`。只查看操作说明可运行：

```sh
npm run submit -- --dry-run "docs: 更新说明"
```

`.gitignore` 排除了用户数据、依赖、旧发布目录、测试输出和常见证书文件；脚本也会检查暂存区，发现运行资料或密钥时停止提交。请将证书和密码放在 GitHub Secrets 中。

## 发布正式版本

```sh
npm version patch
git push origin main --follow-tags
```

`npm version patch` 会更新 `package.json` 和锁文件、创建版本提交和标签，需要干净的工作区。该次推送可能同时生成分支预发布版和版本正式版，这是两个独立的工作流运行。

## 签名与 Mac 公证

没有证书时仍会生成开发预览安装包。Windows 安装包没有受信任的发布者签名；Mac 使用临时签名，不经过 Apple 公证，不能保证通过其他 Mac 的 Gatekeeper 验证。正式分发的 Mac 包需要配置 Developer ID Application 证书和公证身份。不要将私钥提交到仓库。

在仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加需要的项目：

| Secret | 内容 | 用途 |
| --- | --- | --- |
| `WIN_CSC_LINK` | Windows 签名证书的 Base64 内容或下载链接 | 可选，Windows 签名 |
| `WIN_CSC_KEY_PASSWORD` | Windows 证书密码 | 配合 Windows 证书 |
| `MAC_CSC_LINK` | Developer ID Application `.p12` 证书的 Base64 内容 | Mac 签名 |
| `MAC_CSC_KEY_PASSWORD` | Mac 证书密码 | 配合 Mac 证书 |
| `APPLE_ID` | Apple Developer 账号邮箱 | Mac 公证 |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple 应用专用密码 | Mac 公证 |
| `APPLE_TEAM_ID` | Apple Developer Team ID | Mac 公证 |

配置完整后构建自动签名、公证并装订公证票据；缺少公证身份时只进行可用的签名步骤。发布本身使用 GitHub 自动提供的 `GITHUB_TOKEN`，无需另建个人访问令牌。工作流仅给最终发布任务 `contents: write` 权限。

如果组织策略限制 Actions 或令牌权限，需要在仓库/组织的 Actions 设置中允许工作流运行和发布 Release。构建状态见仓库的 [Actions](https://github.com/luabuCN/MoYu/actions)，下载见 [Releases](https://github.com/luabuCN/MoYu/releases)。

## 本地打包

```sh
npm ci
npm test
npm run dist:win
```

Windows 安装包位于 `release/`。Mac 上执行 `npm run dist:mac`，生成 arm64 和 x64 两种 DMG；Mac 安装包应在 macOS 上构建。`npm run package` 仍生成原有 Windows 免安装版，`npm run package:update` 更新已存在的免安装版并保留资料。

安装版、源码版和免安装版各自有独立数据目录，路径见主 README。升级同一种安装方式会继续使用该资料目录。卸载安装版默认保留用户资料。

实现参考：[GitHub 推送事件](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushbranchestagsbranches-ignoretags-ignore)、[electron-builder NSIS](https://www.electron.build/v26/docs/nsis/)、[Mac 打包与签名](https://www.electron.build/v26/docs/mac/)、[Mac 公证](https://www.electron.build/v26/docs/notarization/)。
