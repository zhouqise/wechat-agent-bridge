# 管理面板完善方案

任务 20261019-feature-dashboard-management；设计版本 2；2026-10-19。依据 requirement.md 与 context.md，基线 0ed32dc1dac1f51acf5f07c7b4df4d447663f6f1。生命周期见 status.json；审核历史见 design-review.md。

## 1. 页面与操作总览

保留左侧用户选择，增加“新增用户”入口；右侧按当前用户展示状态、工作目录、引擎/模型、认证、任务/会话和独立日志。主要结果就近展示，不再共用底部输出框。仅本机持有管理链接的操作者能访问。

| 区域 | 操作与可见结果 |
| --- | --- |
| 日志 | 点击查看立即读取当前用户末尾日志并定位最新行；打开后每 3 秒刷新，默认跟随，用户向上滚动时暂停跟随，可点击回到底部。显示文件最后写入时间和本次读取时间，无更新明确显示。关闭区域停止刷新。清除前确认，清除当前用户当前日志和轮转日志，不影响工作文件；正在运行的服务可继续写新日志。 |
| 模型 | 按钮下独立显示“某引擎可选模型”、当前设置和结果；可点模型填入输入框，再点击设置模型生效。模型目录未知时明确提示，保留手动输入，不冒充账号授权清单。 |
| 工作目录 | 将“切换项目”移入此卡片并改称“已保存目录”；选项显示名称与完整路径，说明它只是常用目录快捷入口，选择后切换实际工作目录并恢复对应会话。保留 /项目 命令兼容。 |
| 新增用户 | 填合法名称，创建独立工作区，继承默认用户现有引擎设置；页面显示二维码、扫码状态、必要时输入手机配对码。绑定成功后自动启动，若启动失败显示“已绑定，启动失败”并保留重试入口。取消/超时保留未绑定用户，可继续绑定，不覆盖同名已有用户。 |
| 认证 | Codex、Claude 分别设置 local/api、API 地址和密钥变量名。页面只显示“变量已设置/未设置”，不显示或接收密钥。local 使用本机 CLI 现有登录；切换本机账号仍由对应 CLI 官方登录流程完成。 |

认证配置采用“停止后保存，再启动”的明确流程：运行时表单可查看编辑，但保存按钮禁用并显示原因，使用现有空闲停止按钮后保存，再启动。相比自动重启，此方式避免在用户修改多项配置期间意外重启或将失败伪装成回滚，代价是多一次启动点击。任务忙碌时不能停止。页面提示环境变量来自启动面板的终端，新增或更换变量值后须从有该环境的终端重新打开面板；已运行守护进程不会自动继承新的环境。

验收重点是日志新鲜度、结果不串用户/引擎、绑定状态真实、配置不泄密且不打断任务。二维码与配对码属于本机页面短期敏感内容，不记录到日志。测试不向真实微信发消息、不更换真实账户。用户确认完整设计后再实施。

## 2. 当前链路与职责

source-proven：dashboard.mjs 已有回环监听、Bearer 令牌、Host/Origin 校验和 4096 字节请求限额，所有管理操作通过 POST /api。现有 logs 读尾部但页面不跟随；模型仅返回文本。用户配置保存在各用户 config.json，微信凭据在 session.json；daemon 持有 running.lock。现有 login 与终端输入紧耦合，新增网页绑定不能直接把终端输出当状态协议。

目标职责：面板负责鉴权、所选用户与展示；公共日志能力负责尾读/清除；模型目录能力输出结构化结果并继续兼容微信文本；用户创建和公共微信绑定能力负责受控生命周期；引擎认证配置能力负责字段验证、环境变量引用与停止状态保存。CLI 与面板调用相同基础能力，不新增后台管理常驻服务或数据库。

## 3. 日志、模型与目录处理

日志只访问 paths 给定的 service.log 与 service.log.1，不接受任意文件路径。尾读限制 16000 字节，返回 UTF-8 文本，若从中间截断则丢弃不完整首行；按时间正序展示，最新行在底部。文件修改时间与读取时间独立返回，沿用并增强密钥形态脱敏；API 返回内容不写二次日志。遇到非普通文件或符号链接拒绝。读取和清除之间发生追加可能看到新日志，这是预期，不承诺清除后的文件一直为空。

清除逐一打开并验证普通文件，在原文件描述符上 truncate(0)，不 rename/unlink 当前日志，保持运行进程的 append 描述符有效。每用户面板操作互斥；轮转或 CLI 启动竞争时，按当前打开文件处理并重新读取当前日志，若仍有历史内容提示重试，不声称原子清理所有历史。单文件失败返回已清除文件数量与未完成提示，不回滚已清除内容。清除不停止服务，页面必须确认“清除当前用户当前及轮转日志，无法恢复”；保留清理后新产生内容。

模型目录输出 engine、currentModel、items[{id,label}]、source、message，来源枚举 cli/unavailable；结果最多 50 项，保留当前超时与过滤规则。微信 modelListText 由同一目录结果格式化，继续提供原命令指导。Codex API 不在本次新增服务商 /models 协议，返回 unavailable 与原因；Claude 查询失败备用别名单独在 message 说明，不作为真实目录选项。列表请求捕获用户/引擎版本，过期响应丢弃；刷新/切换用户、引擎、认证后清空列表，避免跨身份缓存。

已保存目录仍复用 projects/currentProject。inspect 保留原 projects 字符串数组，新增 projectEntries[{name,path}]；停用时面板从配置构建同结构。所有页面目录切换走现有 workspace 入口，保留停止保存与在线忙碌拒绝语义；名称快捷选项转换为服务端登记路径，不允许客户端伪造名称与目录关系。

## 4. 新增用户与微信绑定

继承 provisionUser 的名称规则、独立工作区与配置字段复制，不复制绑定、会话或密钥。若扩展 Claude 变量名/地址，继承其引用设置。名称碰撞直接拒绝，客户端发生未知创建结果后刷新用户列表，不自动重试覆盖。

将二维码获取、状态轮询、可信重定向、配对码、到期和最终保存分离为共享绑定流程；终端负责原有打印/输入适配，面板负责结构化状态适配。两入口都必须取得该用户运行锁，并在锁内重读 session，已经绑定则拒绝，不支持面板强制改绑。绑定轮询复用现有 trustedBase 与 API 超时/重试规则，持续最多 5 分钟、连续失败最多 4 次；重复提交配对码仅接受当前 need-code 状态，按一次待处理输入消费，不写磁盘或日志。

面板保存内存 operationId（随机不可猜 ID）、user、phase、expiresAt；阶段 starting、waiting、scanned、need-code、committing、bound、starting-service、completed、failed、cancelled。二维码图片仅通过已鉴权 POST 响应返回 data URL，不增加公开二维码文件 GET 路由。terminal 仅在操作结束及锁清理后为 true，前端只依此停止轮询，不能把提交后短暂 bound 当作终态。查询状态不返回微信 token/owner/bot/cursor 或配对码。确认绑定后先持久保存 session、清除二维码并释放绑定锁，再调用用户服务启动；成功才显示 completed，启动失败保留 bound 事实。

同一用户同一时刻只有一个绑定流程，重复 begin 返回现有操作；与 CLI 或其他面板冲突由文件锁拒绝。操作 status/code/cancel 绑定 operationId 与当前 user，不匹配拒绝。绑定内部另有 preparing、committing、committed 阶段：最后一次取消检查与进入 committing 之间不得 await，持久化临时文件 rename 为 session.json 是提交点。取消在 preparing 时发出中止信号，并等待在途请求及操作完全结束后才释放本进程锁，迟到 confirmed 不再写入；从 committing 开始，取消/面板关闭必须等待保存完成，成功返回 bound，失败返回 failed，之后才清理并释放锁。取消/关闭抑制尚未发出的服务启动；若启动已发出则等待结果、展示实际运行状态，不中断已启动服务。不得返回 cancelled 后仍迟到写入，不删除已提交凭据。面板正常关闭等待所有绑定操作完成上述清理。异常退出后保留的锁沿用现有 PID 检测，下次可恢复，绝不根据旧 PID 杀未知进程。

状态轮询每 1 秒，页面切换用户不把另一用户状态展示过来；可返回原用户继续查看，窗口关闭不撤销已绑定结果。失败/取消终态保留 10 分钟便于刷新查询，再清理内存；重开面板时通过配置/session 推断“已创建未绑定”或“已绑定”，不会重放二维码。二维码到期提供重新绑定按钮。CLI 原有强制改绑仍保留，不新增页面覆盖入口。

## 5. 认证配置与执行环境

每用户每引擎保留现有 engineAuth、engineModel、engineProxy；本次页面编辑认证相关字段和可选模型，不覆盖代理或目录，历史会话按下述认证配置隔离保留。Codex 字段 codexAuth、codexBaseUrl、codexApiKeyEnv；Claude 新增 claudeBaseUrl、claudeApiKeyEnv，未配置时兼容 ANTHROPIC_BASE_URL、ANTHROPIC_API_KEY。默认变量名分别 OPENAI_API_KEY、ANTHROPIC_API_KEY；地址空值代表使用环境/官方默认，不是无效 URL。

配置读取只返回允许列表字段、当前引用变量是否非空，以及脱敏后的状态，不返回 process.env、完整 config 或任何变量值。保存体仅接受 engine、auth、baseUrl、apiKeyEnv、可选 model；拒绝 apiKey/token/password 等额外字段。auth 仅 local/api，变量名采用现有标识符规则且最长 128，地址最长 1024；地址仅 HTTPS 或回环 HTTP，不含账号密码、查询串或片段，与 Codex 既有校验保持一致。api 模式要求引用变量存在；Codex 仍要求有效 API 模型 ID，不暗设默认模型，缺失时提示在认证表单同时填写模型，见下段。

认证保存只在确定服务停止时取得运行锁，锁内重读配置，校验完整候选后原子替换 config.json，再释放锁；超时或状态未知不得尝试离线覆盖。保存成功返回 next-start，启动失败不撤销已保存设置，用户可修正或改回 local。多个面板保存由锁互斥，最后成功的显式保存生效。页面不预填回显秘密。

为避免 API 模式初次配置必须先启动服务的循环，认证表单提供 model 输入，与认证同次验证、同次原子提交。model 省略表示保留原配置；空字符串或 default 表示删除显式模型值，其他非空值按现有 modelName 校验，最长 200。Codex API 模式清除后可从 OPENAI_MODEL 回退，若回退仍为空则完整候选无效，不保存；local/Claude 可清除以使用引擎默认。统一 CLI setup、model、微信模型和面板模型入口的 default 语义为删除显式值，不再将字面 default 当模型 ID。停止时模型单独保存复用 CLI 已有锁内保存能力，运行时仍经 IPC。模型变更不创建新的认证分组。

### 认证配置与会话隔离

requirement-confirmed：用户明确选择按认证配置隔离会话，新配置新建，切回旧配置恢复。隔离身份为用户数据根 + 真实目录 + 引擎 + 认证指纹。local 指纹只含 local 标记；api 指纹包含 api 标记、规范化有效 API 地址和密钥变量名，地址取显式配置、当前启动环境或官方默认，去尾部斜线。模型和代理不影响指纹；密钥值从不参与指纹或持久化。有效地址、变量名本身不含秘密。SHA-256 固定序列化值生成指纹，不用随机 ID。

session 增加 authProjectSessions[目录哈希][引擎][认证指纹] 和 schema 标记；旧 projectSessions 与 state[engine] 仅保留为当前分组引用兼容现有 Controller，不作为跨认证回退来源。启动/切引擎/切目录/模型查询所用的会话入口都由同一指纹解析选择。不存在分组则空白会话，不能回退旧全局 state[engine]；切回同指纹读取原分组。

旧 session 第一次升级时，在持有运行锁且旧配置仍有效时，按当时每引擎的有效认证配置将全部已有目录会话登记到对应指纹，保留既有记录和会话 ID并写 schema 标记。认证保存必须先完成这一幂等迁移并保存 session，再原子保存新 config；两文件无跨文件事务，顺序保证配置写失败仍可从旧指纹恢复，session 迁移失败则拒绝改配置，配置成功后新指纹不存在即新建。CLI setup 同样采用此规则，移除原先删除 Codex 会话的分支；字段变更不再清除历史。自动新增用户无历史，不需迁移。

从旧版本无法反推出历史每次认证配置，迁移仅按首次升级时可见的配置归属，不声称恢复从未记录的身份。相同变量名的密钥值在外部更换、同一 local CLI 账号在外部重登录，无法仅凭引用配置识别，页面明确提示此时手动新建会话；不读取或持久化密钥来追踪。升级后回退到不支持认证分组的版本会失去隔离保证，应保留新版本修复，不推荐降级后继续切换服务商。

子进程使用隔离 env 副本，不改 process.env。Claude API 模式把所选变量值映射给子进程 ANTHROPIC_API_KEY，显式配置地址映射到 ANTHROPIC_BASE_URL，并沿用清除 OAuth/认证令牌的行为；local 模式保留现有 CLI 登录配置，不使用页面 API 覆盖。Codex 继续用 provider env_key 指向变量名。doctor、模型目录查询、任务执行、CLI setup 与页面必须共用相同字段规则；默认用户配置复制不复制秘密。变量是否存在仅说明本机已配置，不能宣称远端密钥有效、额度可用。

## 6. 本机接口契约

所有操作沿用 POST /api、application/json、当前 Bearer/Host/Origin 校验和 no-store；默认 user=default，必须解析真实用户路径。新增请求不得接受任意命令、文件名或返回任意环境变量值。请求限制保持 4096 字节；成功 200 JSON，输入/冲突/本机操作错误 400 {error}，鉴权失败 401、来源失败 403、超限 413。返回的错误只含受控消息，不回显外部错误内容、请求体或密钥。现有接口字段保持兼容。

| action | 输入扩展 | 成功输出 |
| --- | --- | --- |
| logs | 无 | {text,updatedAt,readAt,truncated}，时间为毫秒或缺失文件时 null |
| logs-clear | confirm:true | {ok:true,cleared}；失败可附 cleared 数量 |
| models | 无 | 原 text 保留，新增 engine,currentModel,items,source,message |
| users | 无 | 原字段保留，新增 bound 布尔及 projectEntries，绝不返回凭据 |
| user-create | value:合法新用户名 | {ok:true,user,workspace,bound:false}，不隐式强制绑定 |
| pairing-start | 当前 user | {operationId,phase,expiresAt} |
| pairing-status | operationId | {operationId,user,phase,terminal,expiresAt,qrDataUrl?,message?} |
| pairing-code | operationId,value:1–12 位数字 | {ok:true}，只在 need-code 接受 |
| pairing-cancel | operationId | {ok:true,phase}，已提交返回 bound 而非虚假 cancelled |
| auth-read | engine:codex/claude | {engine,auth,baseUrl,apiKeyEnv,keyPresent,model} |
| auth-save | engine,auth,baseUrl,apiKeyEnv,model? | {ok:true,applied:'next-start'} |

models IPC 保持 text，新增结构字段；inspect 保持旧字段并增加 projectEntries。CLI 不依赖新字段，旧消费者兼容。面板读超时与错误提示不会自动重放写操作，未知结果先刷新用户/绑定状态/认证配置。新面板须同版本 daemon；旧 daemon 缺新字段时显示需要重启升级，不解析微信命令文本冒充结构化数据。

## 7. 并发、失败及验证

前端对同一操作禁重入，定时读取不覆盖用户正在编辑的表单；绑定与模型异步结果带请求身份，丢弃过期结果。服务进程持锁时禁止认证离线写；其他运行态更改仍由已有 changing/busy 管理。UI 的禁用仅是提示，服务端必须重查，测试模拟绕过前端请求。

日志清除是不可逆但仅限选定日志，在动作时页面确认；默认不保留隐蔽旧副本。配置原子写入前失败保留旧配置，写入后启动失败明确为已保存未启动。创建失败留下的独立用户目录不自动删除，防止误删已出现的数据；界面区分已创建、待绑定、已绑定未运行。

实现验证覆盖：尾读新鲜度/截断/UTF-8/清理后 append/用户隔离/鉴权；结构化模型来源/超时/切用户旧响应；命名目录与真实路径；模拟二维码、配对码、取消/关闭发生在 session 写入及 rename 前后的竞争、过期、重复名称、启动失败及锁释放；认证 local→api、API A→B、变量名变更与切回旧配置的会话恢复、CLI/页面相同规则、模型省略/default/环境回退/无效候选；双引擎环境映射、字段白名单、秘密不回显、停止锁与失败保存。实际浏览器在临时用户下验证主要页面流程；不代用户扫码、不使用真实密钥。全量 node --test 和三平台 CI 后发布，更新 README/运维/安全说明；保持现有服务状态。

implementation-validation：Windows 打开日志时 truncate、面板关闭期间绑定清理、UTF-8 截断及模型晚到响应由自动化证明。release-validation：真实微信二维码与手机配对码可由用户后续验收；第三方 CLI 登录不在本轮重实现。若某环境验证失败，修复或明确阻止相关发布，不用测试通过推断外部账号有效。

版本 2 已通过独立四轮审核，无未关闭实质问题；用户于 2026-10-19 回复“顺序实施、完成后统一提交”，确认本方案及实施方式。
