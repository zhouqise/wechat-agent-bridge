# 管理面板现状与证据

2026-10-19；基线 0ed32dc1dac1f51acf5f07c7b4df4d447663f6f1，main 唯一工作树，开始时干净。

## 已核实链路

浏览器 dashboard.js → 仅回环 dashboard.mjs → 用户 paths / 控制 IPC → cli.mjs 守护进程。面板用户由持有随机访问凭证的本机管理员选择，非微信消息直接访问。

- dashboard.mjs 的 logs 读取 service.log 末尾 16000 字节，并脱敏；并非从文件头读取。dashboard.js 只点击时获取，不跟随刷新/定位最新行。该结论为源码证据，未读真实日志。
- models 和 logs 共用 output，模型结果出现在页面最底部。models.mjs 目前仅生成微信文本；Codex API 模式没有自动目录，Claude 通过 CLI 查询。
- users.mjs 的 provisionUser 复制默认用户引擎设置并创建独立工作区，拒绝同名。cli.mjs login 负责二维码、轮询、手机配对码、保存绑定，但输入和终端耦合。
- configureEngines 现有 local/api 两类认证；Codex 支持变量名和 API 地址，Claude 固定 ANTHROPIC_API_KEY/ANTHROPIC_BASE_URL。makeController/doctor/模型切换需要一致处理新配置。
- projectList 保留默认目录与已命名目录，真实路径的会话由 engineState 管理。无需新增另一种项目概念。
- start 以 append 模式打开 service.log，超过 2MB 时轮转 service.log.1；清理当前文件不能用替换 inode 的方式，否则运行进程会继续写旧文件。

## 约束与证据边界

Node.js ESM、本机多进程和文件配置；没有适用 Java/组织 Profile、AGENTS 或 formatter。测试是 node --test，远程三平台 Node 22/24 矩阵。浏览器当前展示版本、实际日志内容、真实微信扫码和第三方登录本轮未验证。用户提供的本机页面为目标界面，不扫描其他仓库。

下一步：审核设计并取得用户方案确认，沿用顺序实施、统一提交的已知偏好。
