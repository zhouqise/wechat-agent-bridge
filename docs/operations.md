# 日常管理、升级与多用户

[返回项目首页](../README.md) · [安装配置](setup.md) · [引擎与模型](engines.md) · [媒体与文件](media.md) · [运维与多用户](operations.md)

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
| `/新会话` | 空闲时新建上下文，保留旧会话和文件 |
| `/结果` | 获取最近任务结果 |
| `/批准 编号` | 单次批准操作 |
| `/拒绝 编号` | 拒绝操作 |
| `/回答 编号 内容` | 回答非敏感问题 |

每个用户同一时间只执行一个任务，忙碌时新任务进入本用户队列（最多 10 个等待任务），不同用户可以并行。支持私聊文字、网页链接、图片、微信语音、视频及文档，不处理群聊；不接管 Codex 桌面应用已有聊天。回复最多显示 16000 字，完整最近结果保存在本机状态中。

## 多用户同时运行

原来的微信绑定为 `default`，现有命令继续管理默认用户。新增用户使用独立后台进程、微信扫码绑定、会话、日志、审批和工作目录，可以与默认用户同时执行任务。每个用户自身依次执行队列中的任务。

```bash
wx-agent user add girlfriend       # 创建独立目录，让她扫码，成功后自动启动
wx-agent user list                 # 所有用户的绑定及运行状态
wx-agent user status girlfriend
wx-agent user stop girlfriend
wx-agent user start girlfriend
wx-agent user logs girlfriend
wx-agent --user girlfriend model   # 查看她的模型设置
```

暂时无法扫码时使用 `wx-agent user add girlfriend --no-login`，之后 `wx-agent user login girlfriend` 完成扫码并自动启动。不要让新增用户扫描默认账号的 `login --force` 二维码。再次 add 不会覆盖已有用户。

新增用户复制默认用户的引擎、模型、认证方式和代理配置，共用本机 Codex/Claude 登录与 API Key 环境变量、Office Python 环境及 Whisper 模型；后续切换引擎和模型互不影响。并发使用共用账号额度和机器资源，不保证服务商不发生限流。每个用户只接收自己的审批和结果，不存在全局任务队列。

这是应用层的工作区和会话分离，不是操作系统安全隔离；批准执行命令仍可能访问本机用户权限范围内的其他文件。不要将它作为不可信用户的隔离沙箱。

移除时先 `wx-agent user stop girlfriend`，再 `wx-agent user remove girlfriend`。绑定和文件移入数据目录的 `removed-users`，不删除工作文件；已停止用户不会继续接收消息。升级安装包前需停止所有新增用户，升级后分别启动；`wx-agent update` 发现新增用户仍在运行会拒绝升级，不会打断她的任务。

## 工作区、升级与恢复

切换已登记项目：微信发送 `/项目` 或 `/项目 名称`。各项目、各引擎分别保留会话；切换前须等待当前任务完成并清空等待队列。普通重启保留上下文，但不会自动重跑中断的任务。

升级（v0.13.1 起）：在任意目录执行 `wx-agent update`，检查版本可用 `wx-agent update --check`。自动从本仓库最新稳定 Release 下载并校验 SHA-256，使用当前全局安装位置更新。任务忙碌时拒绝升级；运行中的空闲服务升级后重启，已停止的服务保持停止。安装失败时提示手动修复，不声称已回滚。仅支持全局 tgz 安装，源码安装先手动安装 tgz。Windows 自动通过 Node 启动 npm，无需另写 npm.cmd。

升级下载优先使用 `WX_AGENT_UPDATE_PROXY`，其次 `HTTPS_PROXY`，再使用当前引擎保存的代理。设置 `WX_AGENT_UPDATE_PROXY=direct` 可强制直连。代理下载需要系统 curl（Windows 为 curl.exe）；不接受带账号密码的代理 URL。

旧版本首次升级：停止后安装新的 tgz，再启动，此后即可使用 `wx-agent update`。配置与凭据独立于安装目录，不受包更新影响。旧版 0.2 用户需停止旧进程，在旧源码目录运行 `node wx-agent.mjs migrate`，导入绑定、代理和会话；旧工作区和旧状态文件保留。安装包中不包含任何人的配置或凭据。

微信登录过期：`wx-agent stop` → `wx-agent login --force` → `wx-agent start`。强制登录会将旧会话保存为 `session.json.backup`，重新扫码会建立新绑定及新上下文。

默认数据目录：

- macOS：`~/Library/Application Support/wx-codex`
- Linux：`${XDG_DATA_HOME:-~/.local/share}/wx-codex`
- Windows：`%LOCALAPPDATA%\wx-codex`（通常为 `C:\Users\你的用户名\AppData\Local\wx-codex`）

可用 `WX_CODEX_HOME` 指定短的绝对路径，所有管理命令须使用同一设置。`BRIDGE_STATE_DIR` 是兼容旧环境变量的别名。macOS/Linux 的 Unix 管理套接字路径不得超过 100 字节；Windows 使用命名管道，不受此限制。`BRIDGE_CODEX_PROXY`、`BRIDGE_CLAUDE_PROXY` 分别覆盖两种引擎的代理。

`status --json` 提供机器可读状态。“本机适配器已就绪”不等于远端模型一定可用；“最近成功轮询”用于判断微信连接是否更新。`doctor` 的 HTTP 检测可能受防火墙影响，不代替实际任务验证。

卸载：先停止，再 `npm uninstall -g wx-codex-bridge`（自定义 prefix 安装须带相同 prefix）。用户数据会保留，可根据 `wx-agent paths` 先记下位置再自行清理。不要把数据目录作为公开仓库上传。

## 消息合并与任务队列

- 连续文字等待 1.5 秒；包含附件时等待最后一条消息后的 8 秒，最长从首条起 20 秒。窗口内消息合并为同一任务。
- `/开始`：将等待中的内容封口并立即提交。要发起另一项独立任务，可以先发 `/开始` 再发新消息。
- `/任务` 或 `/队列`：显示当前执行任务及等待任务编号。
- `/取消`：中断当前执行任务；无执行任务时移除第一个等待任务。
- `/取消 编号`：仅移除指定等待任务。`/清空队列`：移除全部等待任务，不影响当前任务。
- 每个合并任务最多 12000 字、4 张图片（合计 20 MB）、4 个文件（各 20 MB）、1 段语音或视频，总媒体项最多 10 个。
- 每用户最多 10 个等待任务；等待中的文件在轮到执行时下载，过期附件需重新发送。其他用户使用自己的队列并行运行。
- 队列内容仅在内存中，停止或崩溃后不自动重跑；本机仅保留未确认任务数量，下一次收到任务会提醒核对并重发。升级会把合并中、等待中和回传中均视为忙碌。

## 登记多个项目

只允许微信切换在电脑上预先登记的目录，不接受微信消息中的任意路径。登记范围属于当前用户，新用户不继承其他人的项目列表。

```bash
wx-agent stop
wx-agent project add demo /absolute/path/to/project
wx-agent project list
wx-agent start
# 微信：/项目 demo
```

Windows 示例：`wx-agent project add demo "C:\Projects\demo"`。目录须已存在。

为指定用户登记：先 `wx-agent user stop girlfriend`，再 `wx-agent --user girlfriend project add demo 完整目录`，完成后 `wx-agent user start girlfriend`。移除登记使用 `project remove demo`（需停止该用户服务），不会删除工作文件。

`default` 为安装时配置的默认工作区。切换项目分别恢复 Codex、Claude 会话；`/新会话` 只为当前项目、当前引擎创建新上下文，旧会话保留。不同项目可使用同一引擎模型设置。请勿让多个用户/项目指向同一工作目录，避免文件相互修改。

## 会话列表、切换与删除

微信命令：

| 命令 | 说明 |
|---|---|
| `/会话` 或 `/会话列表` | 查看当前项目、当前引擎的会话，★ 标记当前会话 |
| `/会话 2` | 查看第 2 页，每页 10 个 |
| `/新会话` 或 `/新会话 名称` | 创建并切换到新会话，保留旧会话 |
| `/切换会话 编号` | 选择列表中的完整编号，下一条任务恢复该上下文 |
| `/删除会话 编号` | 删除该桥接会话记录，保留项目文件和引擎本机历史 |

旧版本当前会话自动登记为“原有会话”，不会丢失原线程引用。未命名的新会话会使用第一条任务的前 60 字作为标题；名称最多 60 字。每个用户、项目、引擎最多保留 100 个桥接会话。

任务执行、合并、排队或回传期间可查看列表，但不能创建、切换或删除。先等待任务结束，或取消当前任务并 `/清空队列`。`/结果` 返回当前会话的最近结果。切换会话不复制或回滚工作区文件；同一项目下所有会话共用工作目录。

删除当前会话会切换到最近使用的其他会话；删除最后一个会话后会创建一个空白会话。删除不清理 Codex/Claude 自己保存的磁盘历史，也不删除上传文件或输出文件。列表仅包含本桥接登记的会话，不扫描或导入桌面应用、CLI 的全部历史。
