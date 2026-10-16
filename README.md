<p align="center">
  <img src="docs/assets/hero.png" alt="WeChat Agent Bridge — 微信连接本机 Codex 与 Claude Code" width="100%" />
</p>

<h1 align="center">WeChat Agent Bridge</h1>

<p align="center"><strong>一台电脑，多个微信用户，AI 任务同时运行。</strong></p>
<p align="center">多人分别扫码 · 任务并行执行 · 多项目与多会话管理<br />让你和家人、协作者，通过各自的微信使用本机 Codex / Claude Code。</p>

<p align="center">
  <a href="https://github.com/zhouqise/wechat-agent-bridge/releases/latest"><img src="https://img.shields.io/github/v/release/zhouqise/wechat-agent-bridge?style=flat-square&amp;color=10b981" alt="Latest release" /></a>
  <a href="https://github.com/zhouqise/wechat-agent-bridge/actions/workflows/test.yml"><img src="https://github.com/zhouqise/wechat-agent-bridge/actions/workflows/test.yml/badge.svg" alt="Cross-platform tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0f766e?style=flat-square" alt="MIT License" /></a>
  <a href="#多人共享一台电脑"><img src="https://img.shields.io/badge/Multi--user-Parallel-10b981?style=flat-square" alt="Multi-user parallel tasks" /></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-334155?style=flat-square" alt="Node.js 22+" />
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-334155?style=flat-square" alt="macOS, Windows and Linux" />
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#功能概览">功能概览</a> ·
  <a href="#多人共享一台电脑">多用户并行</a> ·
  <a href="#微信操作速查">微信命令</a> ·
  <a href="#文档导航">完整文档</a> ·
  <a href="https://github.com/zhouqise/wechat-agent-bridge/releases/latest">下载</a> ·
  <a href="CHANGELOG.md">更新记录</a>
</p>

---

## 多人共享一台电脑

**电脑端安装一次，每个人用自己的微信扫码，分别发起任务。**你可以处理代码，家人或协作者可以同时分析文档；不同用户并行运行，各自的任务按顺序执行。

| 每个用户独立管理 | 所有用户共同使用 |
| --- | --- |
| 微信绑定、任务队列和审批 | 本机安装的 Codex / Claude Code |
| 项目目录、会话列表和最近结果 | 引擎登录、账号额度与 API 配置中的密钥环境变量 |
| 引擎选择、模型设置和输出文件 | 电脑的 CPU、内存与网络 |

完成下方基础安装后，添加一个用户，让对方用自己的微信扫码：

```bash
wx-agent user add teammate     # 创建独立工作区，扫码后自动启动
wx-agent user list             # 查看所有用户
wx-agent user status teammate  # 查看指定用户状态
wx-agent user stop teammate    # 只停止指定用户
```

原有用户为 `default`，不带 `--user` 的命令继续管理默认用户。工作区分离属于应用层管理，**不是操作系统安全隔离**；获批命令仍以本机用户权限执行。详见[多用户使用指南](docs/operations.md#多用户同时运行)。

## 功能概览

| 能力 | 可以做什么 |
| --- | --- |
| **多用户并行** | 多人分别扫码；工作区、队列、上下文与审批分别管理 |
| **双引擎与模型切换** | 微信切换 Codex / Claude Code；支持本机登录、API Key、自定义接口和模型设置 |
| **多项目、多会话** | 切换预先登记的项目；创建、列出、恢复和删除桥接会话，保留各自上下文 |
| **连续消息合并** | 先发文件再补说明，或连续发截图，合并成一项任务 |
| **每用户任务队列** | 忙碌时自动排队；查看任务、立即提交、按编号取消或清空等待队列 |
| **截图与扫描 PDF OCR** | 图片交给模型分析，并可补充本地中英文 OCR；扫描 PDF 按页补充识别文字 |
| **文档处理与自动回传** | 处理 PDF、Excel、Word、PPT、文本附件；成功任务的新结果文件自动发回微信 |
| **视频综合分析** | 视频抽帧 + 音轨分段转文字 + 模型结合分析，支持最长 30 分钟、200 MB 的 MP4 |
| **网页内容分析** | 提取公开网页静态正文，用于总结、比较与追问 |
| **后台管理与升级** | 查看状态、日志和单次审批；关闭终端仍可运行，`wx-agent update` 升级 |

## 快速开始

准备 **Node.js 22+、npm、系统 curl**，以及至少一种已安装并完成认证配置的引擎：[Codex CLI](https://developers.openai.com/codex/cli/) 或 [Claude Code](https://code.claude.com/docs/en/setup)。

### 1. 安装并启动

macOS / Linux：

```bash
npm install -g https://github.com/zhouqise/wechat-agent-bridge/releases/download/v0.18.2/wx-codex-bridge-0.18.2.tgz --ignore-scripts
wx-agent setup
wx-agent start
```

Windows PowerShell：

```powershell
npm.cmd install -g https://github.com/zhouqise/wechat-agent-bridge/releases/download/v0.18.2/wx-codex-bridge-0.18.2.tgz --ignore-scripts
wx-agent.cmd setup
wx-agent.cmd start
```

按提示选择引擎、认证方式、工作目录和代理，再用微信扫码。工作目录可直接回车，使用独立空白工作区，之后无需每条消息指定目录。

安装包通过 GitHub Releases 提供，尚未发布到 npm。全局目录权限、引擎安装及代理配置见[完整安装指南](docs/setup.md)。

### 2. 在微信验证连接

向已绑定的机器人发送：

> 不要调用工具，只回复：微信 AI 助手已连通。

收到回复后，就可以发任务、截图或文件。基础文字任务无需安装下方的媒体处理组件。

### 3. 试一次文件处理

```text
发送：一份 PDF / Excel / Word / PPT
随后发送：总结重点，并把结果整理成 Word 文档。
发送：/开始
```

桥接将附件和说明合并，交给当前引擎；需要授权的操作会在微信请求单次确认。成功任务在 `wx-agent-output` 中新增或修改的受支持文件会自动回传，最多 5 份、每份 20 MB；也可发送 `/文件` 手动取回。

## 在微信管理任务与上下文

### 连续消息合并，不用一次写完

- **连续文字**：等待最后一条消息后的 1.5 秒。
- **包含附件**：等待最后一条消息后的 8 秒，方便补充说明或继续上传。
- **最长合并等待**：从第一条消息起 20 秒；发送 `/开始` 可立即提交。
- **忙碌时**：新任务进入当前用户的队列，最多 10 个等待任务；其他用户继续并行。

要开始另一项独立任务，可先发送 `/开始`，再发送新内容。`/任务` 查看队列，`/取消 任务编号` 移除指定等待任务，`/清空队列` 移除全部等待任务。

队列内容保存在内存中，停止或重启后**不会自动重跑**；恢复后会提示核对未确认任务。

### 会话可切换，命令直接复制

发送 `/会话` 或 `/会话列表`，每项显示名称、完整 ID 和可复制命令。例如：

```text
2. 文档整理
ID：a1b2c3d4
/切换会话 a1b2c3d4
快捷：/切换会话 2
/删除会话 a1b2c3d4
```

复制完整命令即可切换，也可直接输入 `/切换会话 2`。**短序号固定，不随排序变化，删除后不复用。**上面的 ID 仅为示例，请使用自己的列表。

- `/新会话 名称`：创建新上下文，保留旧会话；不填名称时自动取第一条任务作为标题。
- `/会话 2`：翻到第 2 页，每页 10 个会话。
- `/结果`：获取当前会话的最近结果。
- `/删除会话 ID`：移除桥接会话记录，保留项目文件和引擎本机历史。

会话按**用户 → 项目 → 引擎**分别管理，每组最多 100 个。运行、排队或回传期间可以查看列表，变更会话需先结束当前任务并清空等待队列。列表只包含本桥接登记的会话，不导入桌面应用或 CLI 的全部历史。

### 一条微信切换项目

先在电脑上登记允许使用的目录：

```bash
wx-agent stop
wx-agent project add demo /absolute/path/to/project
wx-agent start
```

Windows 路径示例：`wx-agent project add demo "C:\Projects\demo"`。目录需已存在。

之后在微信发送 `/项目` 查看列表，发送 `/项目 demo` 切换。各项目分别恢复对应引擎的会话；同一项目下的多个会话共用工作目录，切换会话不会回滚文件。为指定用户登记项目见[项目管理文档](docs/operations.md#登记多个项目)。

## 按需开启媒体与文档能力

| 输入 | 处理范围 | 额外准备 |
| --- | --- | --- |
| 截图 | PNG / JPEG / WebP；合并任务最多 4 张，单张 10 MB、合计 20 MB | 支持图像输入的模型；本地 OCR 可选 |
| PDF / Office | 合并任务最多 4 份，每份 20 MB；PDF 文字层、表格及文档文本提取 | Python 3、`wx-agent office-setup` |
| 扫描 PDF / 图片 OCR | 本地中英文识别；每份 PDF 最多尝试 20 个无文字页 | Python 3.10+、Tesseract、`wx-agent ocr-setup` |
| 文本附件 | TXT / MD / CSV / TSV / JSON / LOG / YAML / YML / XML；每份 20 MB | 无需 Python |
| MP4 视频 | 最长 30 分钟、200 MB；6–30 帧，音轨按 2 分钟分段转写 | FFmpeg、whisper.cpp、转写模型 |
| 网页链接 | 每项任务最多 3 个；提取公开静态正文 | 网页需能从本机直连访问 |
| 微信语音 | 使用微信消息附带的转文字；无转文字时提示重发文字 | 不自动识别未附带转文字的语音 |

```bash
wx-agent office-setup   # 安装 PDF / Office 环境
wx-agent office-check   # 检查文档组件
wx-agent ocr-setup      # 已安装 Tesseract 后，安装 OCR 组件及中英文语言包
wx-agent ocr-check      # 检查 OCR 环境
wx-agent media-check    # 检查视频组件及转写模型
```

OCR、视频转写可能存在错漏，视频画面是抽样；Office 复杂版式和 Excel 公式计算需复核。登录页面、JavaScript 动态网页可能无法完整读取。支持格式、安装步骤与详细限制见[媒体与文件指南](docs/media.md)。

## 微信操作速查

| 场景 | 命令 |
| --- | --- |
| 引擎与模型 | `/引擎`、`/引擎 claude`、`/引擎 codex`、`/模型`、`/模型 模型名` |
| 会话管理 | `/会话`、`/新会话 名称`、`/切换会话 序号或ID`、`/删除会话 ID` |
| 项目切换 | `/项目`、`/项目 名称` |
| 队列管理 | `/任务`、`/开始`、`/取消 任务编号`、`/清空队列` |
| 进度与结果 | `/状态`、`/取消`、`/结果` |
| 操作确认 | `/批准 审批编号`、`/拒绝 审批编号`、`/回答 编号 内容` |
| 输出文件 | `/文件`、`/文件 result.pdf` |
| 完整帮助 | `/帮助` |

## 运行与升级

无需进入安装目录，在终端直接执行：

```bash
wx-agent status         # 查看当前服务状态
wx-agent stop           # 停止默认用户
wx-agent start          # 后台启动默认用户
wx-agent logs           # 查看最近日志
wx-agent update --check # 只检查新版本
wx-agent update         # 升级到最新稳定版
```

升级保留配置、微信绑定和会话记录。执行、排队或回传中会拒绝升级；多用户使用时，先停止新增用户，升级后分别启动。重新绑定、停用用户与恢复说明见[运维指南](docs/operations.md)。

## 它如何工作

```mermaid
flowchart LR
    W1[用户 A 微信] <--> B1[独立队列与审批 A]
    W2[用户 B 微信] <--> B2[独立队列与审批 B]
    subgraph H[同一台电脑 · 不同用户并行]
      B1 <--> E1[Codex / Claude Code 进程 A]
      B2 <--> E2[Codex / Claude Code 进程 B]
      E1 --> P1[用户 A 的项目与会话]
      E2 --> P2[用户 B 的项目与会话]
    end
```

每个用户有独立 Bridge 进程，连接自己当前选择的引擎。原始资料或提取内容会提交给所选模型服务；本机运行桥接、OCR 和视频预处理，不代表模型推理离线。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [安装与首次配置](docs/setup.md) | 三平台安装、扫码、工作目录与代理 |
| [引擎、认证与模型](docs/engines.md) | 本机登录、API Key、自定义接口与模型切换 |
| [媒体与文件](docs/media.md) | 截图、OCR、音视频、网页、文档处理和自动回传 |
| [运维与多用户](docs/operations.md) | 多用户、任务队列、项目、会话、启停和升级 |
| [开发与贡献](docs/development.md) | 本地验证、打包、协议参考与反馈方式 |
| [安全说明](SECURITY.md) · [更新记录](CHANGELOG.md) | 权限边界及版本变化 |

## 使用前了解

- 电脑需保持唤醒和联网；后台运行不等于开机自启，重启电脑后需再次启动。
- 支持绑定用户的私聊，不支持群聊；能否扫码绑定取决于微信服务端。
- macOS 已有真实连接验证；Windows / Linux 有跨平台自动测试，完整微信与模型链路仍需实机确认。
- 独立开源项目，非腾讯、OpenAI 或 Anthropic 官方产品。请勿在 Issues 中上传二维码、密钥或会话文件。

## 开源与反馈

采用 [MIT 许可证](LICENSE)。欢迎提交 [Issue](https://github.com/zhouqise/wechat-agent-bridge/issues) 或 Pull Request，请附平台、版本、复现步骤和脱敏日志。

<p align="center"><sub>WeChat Agent Bridge · Your coding agents. One conversation away.</sub></p>
