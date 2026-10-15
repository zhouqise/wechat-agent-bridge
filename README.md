# WeChat Agent Bridge · 微信 AI 开发桥接

在个人微信中给本机 Codex 或 Claude Code 发任务，接收结果，并确认需要审批的操作。扫码配置一次，之后在任意目录使用 `wx-agent` 命令。

独立实验项目，非腾讯或 OpenAI 官方产品。当前支持 macOS、Linux 和 Windows 10/11；Windows 新增原生支持。macOS 已做真实连接验证，Windows/Linux 的微信扫码及完整模型任务仍需用户实机验证。微信账号是否可以绑定取决于服务端。

从 v0.8.0 起仅提供 `wx-agent` 命令，已移除 `wx-codex`。安装包名和用户数据目录保持不变，升级后无需重新扫码或迁移会话。

## 安装

需要 Node.js 22+、npm、系统 curl，以及至少一种本机引擎：[Codex CLI](https://developers.openai.com/codex/cli/) 或 [Claude Code](https://code.claude.com/docs/en/setup)。当前核对版本为 Codex CLI 0.159.2、Claude Code 2.1.121。

直接在终端执行以下命令，安装 GitHub Release 中的 v0.8.0：

```sh
npm install -g https://github.com/zhouqise/wechat-agent-bridge/releases/download/v0.8.0/wx-codex-bridge-0.8.0.tgz --ignore-scripts
wx-agent setup
wx-agent start
```

也可以下载源码，解压后进入源码目录执行 `npm install -g . --ignore-scripts`。源码安装可能链接到该目录，请保留源码；推荐普通用户使用 tgz 安装包。尚未发布到 npm，不能直接用包名从 npm 安装。

macOS/Linux 如果 npm 全局目录没有写入权限，可安装到用户目录：

```sh
npm install -g --prefix "$HOME/.local" https://github.com/zhouqise/wechat-agent-bridge/releases/download/v0.8.0/wx-codex-bridge-0.8.0.tgz --ignore-scripts
export PATH="$HOME/.local/bin:$PATH"
```

将这条 PATH 配置加入自己的 shell 配置后，新终端也能找到命令。安装依赖需要能访问 npm；安装包本身不包含 Node.js 或 Codex。

## 首次配置

在电脑终端运行 `wx-agent setup`，依次选择引擎、认证方式（Claude）、工作目录和代理，然后用手机微信扫描终端中的二维码。如要求配对码，在电脑终端输入。

工作目录可以直接回车，使用独立空白工作区。只有需要操作实际项目时才填写该项目的完整路径；每条微信消息无需指定目录。代理需要填写完整地址，例如 `http://127.0.0.1:7890`；无代理直接回车。输入 `direct` 可以清除旧代理。代理只传给所选引擎的子进程及相应连接检查。

配置向导检查所选 CLI 和认证配置，Codex 额外检查网络可达性，不会发起模型任务。微信绑定完成后执行 `wx-agent start`。首次可向机器人发送“不要调用工具，只回复：微信 Codex 已连通”验证完整链路。

## 日常使用

以下命令可以在任意目录执行：

```sh
wx-agent start       # 后台启动，可关闭终端
wx-agent status      # 查看连接、工作目录和任务状态
wx-agent stop        # 停止桥接，终止当前引擎子进程
wx-agent restart     # 重启
wx-agent logs        # 最近日志
wx-agent logs --follow
wx-agent doctor     # 检查 CLI 登录和网络
wx-agent paths      # 查看数据保存位置
```

`wx-agent engine` 查看默认引擎；`wx-agent engine claude` 或 `wx-agent engine codex` 切换，若后台运行会重启。切换前请等待任务完成。

`wx-agent run` 为前台运行模式，Ctrl+C 停止。后台运行不等于开机自启：重启电脑后需执行 `wx-agent start`；电脑须保持唤醒和联网。进程异常退出不会自动重启。停止前建议在微信取消或等待当前任务完成。

| 微信消息 | 功能 |
| --- | --- |
| 普通文字 | 开始任务，延续当前上下文 |
| `/帮助` | 命令说明 |
| `/引擎` | 查看当前引擎 |
| `/引擎 codex` / `/引擎 claude` | 空闲时切换引擎，分别保留会话 |
| `/状态` | 查看任务及工作目录 |
| `/取消` | 请求中断当前任务 |
| `/新会话` | 空闲时新建上下文，保留文件 |
| `/结果` | 获取最近任务结果 |
| `/批准 编号` | 单次批准操作 |
| `/拒绝 编号` | 拒绝操作 |
| `/回答 编号 内容` | 回答非敏感问题 |

同一时间只执行一个任务，忙碌时新任务不排队。当前处理绑定用户的私聊文字和直接发送的图片，不处理群聊、语音、视频或文件附件；不接管 Codex 桌面应用已有聊天。回复最多显示 16000 字，完整最近结果保存在本机状态中。

## 工作区、升级与恢复

更换项目：先 `wx-agent stop`，再 `wx-agent setup` 选择新目录，最后 `wx-agent start`。目录变更会清空桥接使用的旧会话引用，工作文件不删除。普通重启会保留上下文，但不会自动重跑中断的任务。

升级：停止后安装新的 tgz，再启动。配置与凭据独立于安装目录，不受包更新影响。旧版 0.2 用户需停止旧进程，在旧源码目录运行 `node wx-agent.mjs migrate`，导入绑定、代理和会话；旧工作区和旧状态文件保留。安装包中不包含任何人的配置或凭据。

微信登录过期：`wx-agent stop` → `wx-agent login --force` → `wx-agent start`。强制登录会将旧会话保存为 `session.json.backup`，重新扫码会建立新绑定及新上下文。

默认数据目录：

- macOS：`~/Library/Application Support/wx-codex`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/wx-codex`
- Windows：`%LOCALAPPDATA%\wx-codex`（通常为 `C:\Users\你的用户名\AppData\Local\wx-codex`）

可用 `WX_CODEX_HOME` 指定短的绝对路径，所有管理命令须使用同一设置。`BRIDGE_STATE_DIR` 是兼容旧环境变量的别名。macOS/Linux 的 Unix 管理套接字路径不得超过 100 字节；Windows 使用命名管道，不受此限制。`BRIDGE_CODEX_PROXY`、`BRIDGE_CLAUDE_PROXY` 分别覆盖两种引擎的代理。

`status --json` 提供机器可读状态。“本机适配器已就绪”不等于远端模型一定可用；“最近成功轮询”用于判断微信连接是否更新。`doctor` 的 HTTP 检测可能受防火墙影响，不代替实际任务验证。

卸载：先停止，再 `npm uninstall -g wx-codex-bridge`（自定义 prefix 安装须带相同 prefix）。用户数据会保留，可根据 `wx-agent paths` 先记下位置再自行清理。不要把数据目录作为公开仓库上传。

## 开发和验证

```sh
npm ci --ignore-scripts
npm test
npm pack
```

打包使用明确的发布文件清单，排除凭据、工作区、日志和本地配置。源码发布也应使用经过检查的干净源码包，不能直接上传正在运行的整个文件夹。

测试覆盖来源校验、去重、上下文恢复、任务并发、取消、审批、RPC、锁和本机管理接口。详见 [安全说明](SECURITY.md)。

协议依据：[腾讯微信协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md)（参考 2.4.10）及 [Codex App Server](https://learn.chatgpt.com/docs/app-server)。上游接口变化可能需要适配。

## 截图

直接在微信发送截图即可，默认分析截图内容和报错。也可以先发截图，等分析完成后继续问“这个错误怎么修复”；上下文会保留。若同一条消息携带文字和图片，会一起传给 Codex。不同消息不会自动合并，任务执行中收到新任务会提示稍后重发。

支持 PNG、JPEG、WebP；每条最多 4 张，每张下载大小不超过 10 MiB（含加密填充），总解密大小不超过 20 MiB。请用微信图片方式发送，文件附件和引用旧图片暂不支持。收到图片会有接收提示，下载、解密或格式失败会明确回复。图片下载使用微信官方 CDN，不使用 Codex 代理，不自动重试失败的任务。

桥接将图片在内存中解密，通过图像输入交给当前引擎；不把 CDN 密钥或链接传给模型，也不在工作区保存截图文件。图片会提交给当前引擎的模型，并可能保存在对应 CLI 的会话记录中。需使用支持图像输入的模型。

## 开源许可

采用 [MIT 许可证](LICENSE)。欢迎通过 [Issues](https://github.com/zhouqise/wechat-agent-bridge/issues) 报告问题，请勿附带登录凭据、二维码或原始会话文件。`package.json` 中的 `private: true` 用于防止误发布到 npm，不影响 GitHub 开源或安装 Release 包。

## Windows 安装（PowerShell）

安装 Node.js 22 或以上版本，重新打开普通用户 PowerShell，执行：

```powershell
npm.cmd install -g @openai/codex
codex.cmd login
npm.cmd install -g https://github.com/zhouqise/wechat-agent-bridge/releases/download/v0.8.0/wx-codex-bridge-0.8.0.tgz --ignore-scripts
wx-agent.cmd setup
wx-agent.cmd start
wx-agent.cmd status
```

显式使用 `.cmd` 可避免 PowerShell 的脚本执行策略阻止 npm 生成的 `.ps1` 文件，无需修改系统执行策略。停止、重启、日志分别是 `wx-agent.cmd stop`、`wx-agent.cmd restart`、`wx-agent.cmd logs`。后台启动后可以关闭终端，注销或重启 Windows 后需要再次启动；暂不注册 Windows 服务或开机计划任务。

配置向导中工作区填写完整路径，例如 `D:\Projects\demo`，路径包含空格和中文也可使用。请填写原始路径，不要在输入值外额外加引号。建议保留默认用户数据目录，不要把凭据目录放在共享盘中。Windows 使用用户目录继承的 NTFS 权限；POSIX 的 0700/0600 不能代替 Windows ACL。

默认支持 npm 官方全局安装的 Codex，也可通过 `$env:CODEX_BINARY = 'C:\Tools\codex.exe'` 指定原生可执行文件，或指定 npm 包的 `bin\codex.js`。自定义环境变量需在各管理终端保持一致。桥接不会把微信文字拼入 cmd.exe 命令。

若命令找不到，重新打开终端并检查 `npm.cmd config get prefix` 对应目录是否在 PATH。网络检查使用 Windows 自带的 `curl.exe`；代理地址仍需填写完整 URL。桥接以当前 Windows 用户权限运行，不需要以管理员身份安装或启动。

## Claude：本机登录与 API Key

桥接直接调用用户自行安装的 Claude Code CLI，不提供第三方登录服务，不读取或复制登录令牌。两种认证方式都支持：

- `local`：由 Claude Code 自己加载用户级配置和已有认证。先在电脑运行 `claude auth login`，然后 `wx-agent setup` 选择 `claude` → `local`。
- `api`：只读取启动进程环境中的 `ANTHROPIC_API_KEY`，不加载 Claude 用户级设置，也不回退到本机登录。先设置环境变量，再 `wx-agent setup` 选择 `claude` → `api`。API 使用独立额度/计费，密钥不写入桥接配置或微信状态。

macOS/Linux 可通过隐藏输入设置本次终端的 API Key：

```sh
read -r -s ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY
wx-agent setup
wx-agent start
```

Windows PowerShell 可用：

```powershell
$env:ANTHROPIC_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'API Key' -AsSecureString)).Password
wx-agent.cmd setup
wx-agent.cmd start
```

不要把真实密钥贴进微信、issue 或聊天。环境变量仅随当前终端及子进程生效；从另一个终端重启 API 模式时需要重新提供。`ANTHROPIC_BASE_URL` 等环境配置由 Claude Code 本身处理；桥接不会替你把凭据复制到其他服务。

使用 `wx-agent doctor --engine claude` 检查本机 CLI/认证配置；该检查不提交模型请求，不能证明 API Key 有效。`CLAUDE_BINARY` 可指定 Claude 原生程序或 npm 的 `cli.js`。Windows 下兼容 `claude.exe`、新版 npm 包的 `bin/claude.exe` 及旧版 `claude.cmd` 启动器；安装 Claude 本身不要使用 `--ignore-scripts`，它需要官方 postinstall 安装原生程序（桥接包安装仍可使用 `--ignore-scripts`）；安装和认证可按官方安装文档操作，npm 用户可执行 `npm.cmd install -g @anthropic-ai/claude-code`、`claude.cmd auth login`。

微信发送 `/引擎 claude` 即可使用 Claude，`/引擎 codex` 切回。切换只允许在任务空闲时进行；切换失败会保留原引擎。两个引擎分别保存会话和最近结果，`/新会话` 只重置当前引擎。任务不会自动同时发给两个引擎。

Claude 当前开放 Read、Glob、Grep、Bash、Edit、Write 六种工具，调用前均须微信单次确认。文件工具拒绝配置工作区外的路径；Bash 获批后以当前用户权限执行，不等同于 Codex 的 workspace-write 操作系统沙箱。hooks、外部 MCP、技能入口及 Chrome 集成关闭，其他交互默认拒绝。需要完整展示工具参数，详情过长会拒绝执行。

本机认证已验证文字、图像输入、会话恢复与 Read 审批；API Key 模式已验证配置及协议，未使用真实 API Key 做计费请求。微信手机端的引擎切换完整链路仍待用户验证。CLI 流式控制协议可能随上游版本改变，发生不兼容时请提交脱敏的问题描述。

## Codex API Key 与自定义接口

`wx-agent setup` 选择 `codex` → `api`，依次配置 API 基础地址（例如 `https://api.openai.com/v1`）、服务商提供的模型 ID、密钥环境变量名称（默认 `OPENAI_API_KEY`）。先在自己的终端设置该环境变量，再运行 setup/start；密钥不填写在向导中，不写入桥接配置。

macOS/Linux 示例：

```sh
export OPENAI_API_KEY='你的密钥'
export OPENAI_BASE_URL='https://api.openai.com/v1'
export OPENAI_MODEL='服务商提供的模型ID'
wx-agent setup
wx-agent start
```

Windows PowerShell：

```powershell
$env:OPENAI_API_KEY='你的密钥'
$env:OPENAI_BASE_URL='https://api.openai.com/v1'
$env:OPENAI_MODEL='服务商提供的模型ID'
wx-agent.cmd setup
wx-agent.cmd start
```

地址与模型以 setup 保存值优先，未配置时读取上述环境变量；密钥始终从指定环境变量读取。每次从新终端启动、重启或切换至 API 引擎时，需确保该终端已设置密钥。运行中的后台进程不会随终端后续环境变量修改而更新。

接口须兼容 Responses API，不能直接使用仅兼容 Chat Completions 或 Anthropic Messages 的接口。HTTPS 为默认要求，本机回环地址允许 HTTP。`wx-agent doctor --engine codex` 在 API 模式只检查配置和本机 app-server 初始化，不验证密钥有效性、余额或远端模型兼容性，也不发起付费推理。

选择 `local` 可继续沿用 Codex 自己的登录和配置。API 模式通过子进程参数指定独立 provider，不修改全局 Codex 配置，不将密钥放入命令参数，也不回退 ChatGPT 登录。修改认证方式、地址或模型后会重置桥接的 Codex 会话引用，原工作文件保留。配置字段依据 [Codex 官方配置参考](https://developers.openai.com/codex/config-reference/)。

## 切换模型

微信发送 `/模型` 查看当前引擎的模型设置，发送 `/模型 模型名` 切换。终端使用 `wx-agent model` 查看、`wx-agent model 模型名` 切换；Windows PowerShell 使用 `wx-agent.cmd`。例如 Claude 引擎可使用 `/模型 sonnet`；Codex 请填写账号或服务商支持的模型 ID。

两个引擎分别保存模型设置，切换引擎不会覆盖另一侧的模型。运行中无需重启，新模型从下一条任务生效，保留会话上下文；停止时在终端修改则下次启动生效。任务执行中（包括审批、图片下载）禁止切换。尚未指定模型时显示“沿用引擎默认模型”，不猜测实际模型名称。

切换只保存模型选择，不提前发起推理或验证账号额度；若服务商拒绝模型，请改回可用模型后重试。模型切换不会改变引擎、认证方式或 API 地址。
