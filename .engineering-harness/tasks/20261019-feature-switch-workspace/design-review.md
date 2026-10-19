# 工作目录切换方案审查

## 第一次独立审查

方案版本 1；审查类型 subagent；结论 revise。审查范围为本任务 requirement.md、context.md、design.md，以及 projects.mjs、cli.mjs、engines.mjs、service.mjs、paths.mjs、wx-agent.mjs、dashboard.mjs、controller.mjs。

| 轮次 | 结论 | 依据 |
| --- | --- | --- |
| 问题与方案 | pass | 三种入口及任意已有目录符合已确认需求 |
| 证据与源码适配 | pass | 源码能力与拟议行为区分明确 |
| 语义一致性 | revise | 停止信号可能穿过异步配置提交窗口 |
| 可实现性 | revise | 尚需明确关闭等待切换的责任与注入验证 |

D1（P1，guard-effect-race）：design.md 第4节原先只有提交前检查 stopping；paths.mjs 的 writeJSON 存在异步 rename，cli.mjs 的 clean 没有等待目录切换。关闭可能提前释放锁或留下候选连接。

修正：第4节定义目录切换完整操作 Promise，准备阶段可中止，进入提交后允许完成并由关闭流程等待；配置 rename 决定是否生效。第6节补充初始化、session 保存及 config rename 前后停止注入验证。待重新四轮审查。

## 第二次独立审查

审查类型 subagent；结论 pass。复审最新 design.md、design-review.md，沿用首轮需求、上下文与源码证据。

| 轮次 | 结论 | 依据 |
| --- | --- | --- |
| 问题与方案 | pass | 三入口、停止状态和目录会话符合需求 |
| 证据与源码适配 | pass | 拟议修改与源码事实区分，流式解码和关闭等待符合已有边界 |
| 语义一致性 | pass | 准备中止、提交等待、rename 生效与清理构成完整模型 |
| 可实现性 | pass | 生命周期与注入验证明确，无未决关键语义 |

D1 已在方案层面关闭，无新增实质问题；实际保证仍待实现测试。剩余风险包括用户主动共用目录的文件冲突、外部文件系统变更、强制终止，以及非单一事务可能留下额外候选会话记录。真实微信与模型权限尚未验证。
