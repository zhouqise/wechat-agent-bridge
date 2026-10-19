# 工作目录切换交付证据

任务：20261019-feature-switch-workspace；模式：delivery；2026-10-19。

## 当前结论

实现与本机验证完成，待统一提交后执行远程 CI、发布和本机升级。基线 d5feece9c29d263c314742d36ead107321845397；本机 Node 测试，真实微信与模型未验证。

## 分项验证

P-01：`node --test test/workspace.test.mjs` 首次退出 1，workspace.mjs 尚不存在；新增完整路径、停止保存与用户隔离断言尚不能通过。下一步实现最小行为。

## 质量与边界

只修改当前任务范围；仅临时文件测试，不读写真实微信凭据、不发送微信消息。每项完成后固定差异审核；实际发布与升级另记录。

P-01 独立审查发现首次状态 IPC 结果不确定时可能回退离线写入，分类 product-code。已限制只有 ENOENT/ECONNREFUSED 可尝试离线取锁，其余异常拒绝；新增无存活 PID、异常响应的回归测试。修正后 3 项目录测试通过；另有 7 项原工作流测试通过。修正后 fresh-self-review 检查错误分类及锁内重读路径，无剩余实质问题；此轮修正审核独立性低于首轮，整体验收前再独立复核。
P-01 修正快照：bfe2ff0cd24a74f033b589f4c163a42505ff4fe07b70bd4c69b97a89f4353994。

工具元数据修正：注册范围参数误把多个路径作为一个逗号字符串传入；已仅拆分 scope 数组，与已确认计划逐文件范围一致，未修改生命周期或扩大范围。

P-02：首次 `node --test test/workspace-transition.test.mjs` 因 workspace-transition.mjs 不存在退出 1。实现后 8 项切换生命周期与 IPC 测试通过；`node --test test/workspace-transition.test.mjs test/workflow-daemon.test.mjs test/users.test.mjs` 的首次组合共 10 项通过（该轮尚未包含随后增加的 IPC 分块测试）。后台进程覆盖 A→B→A、忙碌拒绝、初始化与配置保存失败、重启恢复；阶段停止采用受控 Promise 故障注入，尚不能替代真实操作系统强制终止验证。

P-02 独立 subagent 审查通过，无实质问题；固定快照 sha256:52eccce038f3c869e9543c62b3632c552b172ccc4268a96ff81cf583079ed219，检查范围：cli.mjs, service.mjs, workspace-transition.mjs, test/workspace-transition.test.mjs, test/workflow-daemon.test.mjs。

P-03：首次 CLI/HTTP 测试因未知 workspace 操作失败；实现后 `node --test test/dashboard.test.mjs test/workspace.test.mjs` 共 6 项通过。实际浏览器在临时用户数据目录输入中文空格路径并点击切换，显示规范化目录与“下次启动生效”，服务仍停止。测试未切换真实用户目录。

P-03 独立复核通过：user list 原先仍显示默认目录，已修正为当前实际目录并增加断言；修正后 6 项 focused 测试通过。复核快照 sha256:ee5d41a933b2115e45b106785ccae8b7bddaaec9b9fe04536e02b8d7eab0d724。P-01 的 IPC 不确定状态修正也经独立复核确认关闭。

P-04 Red：安装文件清单断言退出 1，缺少 workspace.mjs（同时缺少 workspace-transition.mjs）。文档一致性范围补充 docs/setup.md 的安装版本链接与 SECURITY.md 的权限/面板说明，不改变行为设计。

P-04：安装清单断言和 npm pack 通过，37 个文件包含两个新增模块，不含会话、配置、工程台账及测试。所有版本入口和安装链接为 0.21.0。独立复核 passed，指纹 sha256:89ee60cef15ded6f114151e2a1ed4d2609b074c854709863c4f2d9f774bd2144（按 README.md、docs/operations.md、docs/setup.md、SECURITY.md、CHANGELOG.md、package.json、package-lock.json、rpc.mjs、wx-agent.mjs、.github/workflows/test.yml 的路径与原始内容拼接）。

最终本机 npm test：120 通过、0 失败、0 跳过，约 30 秒。git diff --check 通过。Node v23.11.0 / macOS；未配置仓库 formatter，不声称格式化器验证。实现、故障注入、模拟微信/引擎后台进程、临时面板浏览器交互与安装包清单均验证；未向真实微信发送测试消息。远程 Linux/macOS/Windows × Node 22/24 证据将在提交后获取，发布和实际升级结果以交付消息为准。

升级前刷新真实状态：default 已绑定、运行且空闲；girlfriend 未绑定且停止。升级应恢复运行中的默认服务，保持其他用户停止。此前临时面板已关闭并清理。
