# 工作目录切换上下文

## 已核实的现状

目标仓库为 zhouqise/wechat-agent-bridge，基线提交 d5feece9c29d263c314742d36ead107321845397，2026-10-19 检查。只有当前 main 工作树，开始时无未提交业务变更。

| 证据 | 与本功能的关系 |
| --- | --- |
| projects.mjs | projectList 合并默认目录与登记表；projectPath 仅接受登记名称并解析真实路径 |
| cli.mjs | 微信 /项目 与管理接口通过 selectEngine 重建引擎；changing 与任务队列控制忙碌状态 |
| engines.mjs | 通过用户状态内的 cwd 哈希和引擎名分别保存会话 |
| wx-agent.mjs | project add/remove 必须取得用户进程锁，运行时不可直接改配置 |
| dashboard.mjs、dashboard/dashboard.js | 本机面板鉴权后按用户转发管理操作；目前只能选登记项目 |
| paths.mjs | 用户路径、进程锁、临时文件替换配置；持久化配置与会话是两个独立文件 |
| service.mjs | 单次 IPC 请求最多 1024 字符，admin 超时 65 秒，value 在守护进程目前限制 100 字符 |
| test/workflow-daemon.test.mjs | 模拟微信、真实后台进程与模拟引擎，已有按项目恢复上下文的测试支撑 |
| package.json、.github/workflows/test.yml | Node.js ESM，node --test；三系统与 Node 22/24 矩阵 |

## 适用约束与证据边界

应用为单仓库 Node.js 本机桥接，不适用 Java/COLA 或组织服务配置。未发现此仓库 AGENTS.md、CLAUDE.md 或已有工程规则注册表。沿用仓库测试方式；不新增无依据的格式化检查。

以上是源码证据，并未实测新切换行为。外部运行中的用户配置、凭据与工作文件未读取。后续只在临时测试目录验证，发布和升级延续用户之前的授权，保持既有服务状态。

## 下一步

需求基线和任意完整路径权限已由用户确认；审核 design.md 后等待明确方案确认，再安排实现。阅读范围为本仓库及已启用技能说明，不需要其他仓库。
