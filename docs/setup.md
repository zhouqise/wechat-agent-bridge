# 安装与首次配置

[返回项目首页](../README.md) · [安装配置](setup.md) · [引擎与模型](engines.md) · [媒体与文件](media.md) · [运维与多用户](operations.md)

## 安装

需要 Node.js 22+、npm、系统 curl，以及至少一种本机引擎：[Codex CLI](https://developers.openai.com/codex/cli/) 或 [Claude Code](https://code.claude.com/docs/en/setup)。当前核对版本为 Codex CLI 0.159.2、Claude Code 2.1.121。

直接在终端执行以下命令，安装 GitHub Release 中的 v0.18.1：

```sh
npm install -g https://github.com/zhouqise/wechat-agent-bridge/releases/download/v0.18.1/wx-codex-bridge-0.18.1.tgz --ignore-scripts
wx-agent setup
wx-agent start
```

也可以下载源码，解压后进入源码目录执行 `npm install -g . --ignore-scripts`。源码安装可能链接到该目录，请保留源码；推荐普通用户使用 tgz 安装包。尚未发布到 npm，不能直接用包名从 npm 安装。

macOS/Linux 如果 npm 全局目录没有写入权限，可安装到用户目录：

```sh
npm install -g --prefix "$HOME/.local" https://github.com/zhouqise/wechat-agent-bridge/releases/download/v0.18.1/wx-codex-bridge-0.18.1.tgz --ignore-scripts
export PATH="$HOME/.local/bin:$PATH"
```

将这条 PATH 配置加入自己的 shell 配置后，新终端也能找到命令。安装依赖需要能访问 npm；安装包本身不包含 Node.js 或 Codex。

## 首次配置

在电脑终端运行 `wx-agent setup`，依次选择引擎、认证方式（本机登录或 API Key）、工作目录和代理，然后用手机微信扫描终端中的二维码。如要求配对码，在电脑终端输入。

工作目录可以直接回车，使用独立空白工作区。只有需要操作实际项目时才填写该项目的完整路径；每条微信消息无需指定目录。代理需要填写完整地址，例如 `http://127.0.0.1:7890`；无代理直接回车。输入 `direct` 可以清除旧代理。代理只传给所选引擎的子进程及相应连接检查。

配置向导检查所选 CLI 和认证配置，Codex 额外检查网络可达性，不会发起模型任务。微信绑定完成后执行 `wx-agent start`。首次可向机器人发送“不要调用工具，只回复：微信 Codex 已连通”验证完整链路。

## Windows 安装（PowerShell）

安装 Node.js 22 或以上版本，重新打开普通用户 PowerShell，执行：

```powershell
npm.cmd install -g @openai/codex
codex.cmd login
npm.cmd install -g https://github.com/zhouqise/wechat-agent-bridge/releases/download/v0.18.1/wx-codex-bridge-0.18.1.tgz --ignore-scripts
wx-agent.cmd setup
wx-agent.cmd start
wx-agent.cmd status
```

显式使用 `.cmd` 可避免 PowerShell 的脚本执行策略阻止 npm 生成的 `.ps1` 文件，无需修改系统执行策略。停止、重启、日志分别是 `wx-agent.cmd stop`、`wx-agent.cmd restart`、`wx-agent.cmd logs`。后台启动后可以关闭终端，注销或重启 Windows 后需要再次启动；暂不注册 Windows 服务或开机计划任务。

配置向导中工作区填写完整路径，例如 `D:\Projects\demo`，路径包含空格和中文也可使用。请填写原始路径，不要在输入值外额外加引号。建议保留默认用户数据目录，不要把凭据目录放在共享盘中。Windows 使用用户目录继承的 NTFS 权限；POSIX 的 0700/0600 不能代替 Windows ACL。

默认支持 npm 官方全局安装的 Codex，也可通过 `$env:CODEX_BINARY = 'C:\Tools\codex.exe'` 指定原生可执行文件，或指定 npm 包的 `bin\codex.js`。自定义环境变量需在各管理终端保持一致。桥接不会把微信文字拼入 cmd.exe 命令。

若命令找不到，重新打开终端并检查 `npm.cmd config get prefix` 对应目录是否在 PATH。网络检查使用 Windows 自带的 `curl.exe`；代理地址仍需填写完整 URL。桥接以当前 Windows 用户权限运行，不需要以管理员身份安装或启动。
