# 引擎、认证与模型

[返回项目首页](../README.md) · [安装配置](setup.md) · [引擎与模型](engines.md) · [媒体与文件](media.md) · [运维与多用户](operations.md)

## Claude：本机登录与 API Key

桥接直接调用用户自行安装的 Claude Code CLI，不提供第三方登录服务，不读取或复制登录令牌。两种认证方式都支持：

- `local`：由 Claude Code 自己加载用户级配置和已有认证。先在电脑运行 `claude auth login`，然后 `wx-agent setup` 选择 `claude` → `local`。
- `api`：读取指定密钥环境变量（默认 `ANTHROPIC_API_KEY`），不加载 Claude 用户级设置，也不回退到本机登录。先设置环境变量，再 `wx-agent setup` 选择 `claude` → `api`。API 使用独立额度/计费，密钥不写入桥接配置或微信状态。

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

不要把真实密钥贴进微信、issue 或聊天。环境变量仅随当前终端及子进程生效；从另一个终端重启 API 模式时需要重新提供。API 模式可在 setup 或面板中指定 API 基础地址和密钥变量名。地址以保存值优先，其次 `ANTHROPIC_BASE_URL`，最后使用官方地址；所选变量在子进程中映射到 `ANTHROPIC_API_KEY`，不会把值写入桥接配置。

使用 `wx-agent doctor --engine claude` 检查本机 CLI/认证配置；该检查不提交模型请求，不能证明 API Key 有效。`CLAUDE_BINARY` 可指定 Claude 原生程序或 npm 的 `cli.js`。Windows 下兼容 `claude.exe`、新版 npm 包的 `bin/claude.exe` 及旧版 `claude.cmd` 启动器；安装 Claude 本身不要使用 `--ignore-scripts`，它需要官方 postinstall 安装原生程序（桥接包安装仍可使用 `--ignore-scripts`）；安装和认证可按官方安装文档操作，npm 用户可执行 `npm.cmd install -g @anthropic-ai/claude-code`、`claude.cmd auth login`。

微信发送 `/引擎 claude` 即可使用 Claude，`/引擎 codex` 切回。切换只允许在任务空闲时进行；切换失败会保留原引擎。两个引擎分别保存会话和最近结果，`/新会话` 只为当前项目和引擎创建新会话，旧会话可用 `/会话` 查看和恢复。任务不会自动同时发给两个引擎。

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

选择 `local` 可继续沿用 Codex 自己的登录和配置。API 模式通过子进程参数指定独立 provider，不修改全局 Codex 配置，不将密钥放入命令参数，也不回退 ChatGPT 登录。认证方式、有效地址或密钥变量名不同会使用独立会话组，切回原配置恢复原组；模型变更保留上下文。工作文件保留。配置字段依据 [Codex 官方配置参考](https://developers.openai.com/codex/config-reference/)。

## 切换模型

微信发送 `/模型` 查看当前引擎的模型设置，发送 `/模型 模型名` 切换。终端使用 `wx-agent model` 查看、`wx-agent model 模型名` 切换；Windows PowerShell 使用 `wx-agent.cmd`。例如 Claude 引擎可使用 `/模型 sonnet`；Codex 请填写账号或服务商支持的模型 ID。

两个引擎分别保存模型设置，切换引擎不会覆盖另一侧的模型。运行中无需重启，新模型从下一条任务生效，保留会话上下文；停止时在终端修改则下次启动生效。任务执行中（包括审批、图片下载）禁止切换。尚未指定模型时显示“沿用引擎默认模型”，不猜测实际模型名称。

切换只保存模型选择，不提前发起推理或验证账号额度；若服务商拒绝模型，请改回可用模型后重试。模型切换不会改变引擎、认证方式或 API 地址。

`/模型` 和 `wx-agent model` 现在同时显示模型列表：Codex 本机模式从 app-server 获取目录；Claude 通过独立 CLI 初始化读取模型目录（不提交推理任务），查询失败时才显示备用别名。Codex API 模式提示到服务商控制台确认，不将官方目录误作第三方服务商可用模型。目录获取失败时保留当前设置，仍可输入已知 ID。

Claude 的 `/模型` 现在从 CLI 初始化响应读取真实模型目录，支持 `sonnet[1m]` 等带上下文后缀的名称。列表仍由 CLI/服务配置决定，不保证账号额度。显示的“最近任务实际模型”来自最近一次任务的 system/init 事件；尚无任务或刚切换模型时明确显示未确认，不将别名猜测为实际模型。目录查询不会发送用户任务，不修改已有会话，独立查询进程在完成或超时后退出。

## 页面修改认证与会话隔离

1. 在 `wx-agent dashboard` 中选择用户和要配置的引擎，点击「读取配置」。
2. 等任务空闲，停止该用户服务，再修改认证方式、API 基础地址、密钥环境变量名和模型。
3. 点击「读取配置」会保留已选择的认证方式；页面分别显示当前选择、已保存方式、API 实际地址及其来源。地址输入框为空表示沿用环境变量或官方默认，不是没有地址。只读取桥接配置和启动面板时的环境，不读取 Claude Code 的 settings.json。
4. 保存后手动启动。页面不接收密钥，只显示指定环境变量是否存在；存在不代表远端认证有效。

API 地址必须为 HTTPS（本机回环地址可用 HTTP），不能包含账号、密码、查询参数或片段。空地址沿用环境变量或官方默认；变量名留空采用对应引擎默认名。API 模式保存时要求变量存在。页面可分别配置 Codex 和 Claude，不会改变另一侧配置。官方账号登录/切换仍通过 `codex` 或 `claude auth login` 完成。

会话按用户、真实工作目录、引擎及认证指纹隔离。指纹包括认证方式、API 有效地址、密钥变量名，不包含密钥值、模型或代理。新配置首次使用新会话组，切回旧配置恢复原上下文；原会话不会被删除。旧版会话首次迁移归属于迁移时的原配置。

同名环境变量更换密钥、本机 CLI 切换账号，桥接无法识别，请手动 `/新会话`。改变启动环境后需重开面板和重新启动服务，运行中进程不会自动读取其他终端的环境。

模型输入 `default` 或留空会清除桥接显式模型选择，使用引擎/环境默认；不会新建认证会话组。Codex 在线恢复默认会先准备新的引擎连接，失败保留原设置。
