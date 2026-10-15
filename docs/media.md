# 图片、视频、网页与文件

[返回项目首页](../README.md) · [安装配置](setup.md) · [引擎与模型](engines.md) · [媒体与文件](media.md) · [运维与多用户](operations.md)

## 截图

直接在微信发送截图即可，默认分析截图内容和报错。也可以先发截图，等分析完成后继续问“这个错误怎么修复”；上下文会保留。若同一条消息携带文字和图片，会一起传给 Codex。不同消息不会自动合并，任务执行中收到新任务会提示稍后重发。

支持 PNG、JPEG、WebP；每条最多 4 张，每张下载大小不超过 10 MiB（含加密填充），总解密大小不超过 20 MiB。请用微信图片方式发送，文件附件和引用旧图片暂不支持。收到图片会有接收提示，下载、解密或格式失败会明确回复。图片下载使用微信官方 CDN，不使用 Codex 代理，不自动重试失败的任务。

桥接将图片在内存中解密，通过图像输入交给当前引擎；不把 CDN 密钥或链接传给模型，也不在工作区保存截图文件。图片会提交给当前引擎的模型，并可能保存在对应 CLI 的会话记录中。需使用支持图像输入的模型。

## 语音和视频

语音只使用微信消息附带的转文字，交给当前引擎处理。如果微信未附带转写，会提示先在微信转成文字，再重新发送文字内容；不会下载语音或调用识别服务。

直接发送 MP4 视频可分析画面：每条最多一个视频，最长 30 分钟、最大 200 MB。按时长均匀抽取 6–30 帧并附时间标记，同时将首条音轨按 2 分钟分段离线转写为带时间范围的文字，交给模型结合分析。抽样不能覆盖全部动作或细节，转写可能有错漏；不识别人声身份或非语音音效。两种引擎均以文字回复。

视频需要 FFmpeg（包含 ffprobe）。macOS 可运行 `brew install ffmpeg`；Windows/Linux 按 [FFmpeg 官方说明](https://ffmpeg.org/download.html) 安装并加入 PATH，也可通过 FFMPEG_BINARY、FFPROBE_BINARY 指定绝对路径（Windows 使用 .exe）。随后运行 `wx-agent media-check`；修改环境变量后重启桥接。

处理期间可以 `/状态`、`/取消`。临时视频和帧文件在完成、失败或正常停止后删除；微信转写文字和视频抽样画面交给所选模型服务，可能保存在该引擎会话记录中。微信语音不需要识别模型；视频音轨离线识别需要下述组件，无需额外 API Key。

## 视频音轨离线转写

视频音轨使用 whisper.cpp 在本机识别。macOS 安装 `brew install whisper-cpp`；Windows/Linux 按 [whisper.cpp 官方说明](https://github.com/ggml-org/whisper.cpp) 安装 `whisper-cli`。从 [官方模型仓库](https://huggingface.co/ggerganov/whisper.cpp/tree/main) 下载多语言 `ggml-base.bin`（约 142 MiB），放到 `wx-agent paths` 数据目录下的 `models/ggml-base.bin`，或设置 `WHISPER_MODEL` 为绝对路径。`WHISPER_BINARY` 可指定可执行文件路径；Windows 使用 .exe。

运行 `wx-agent media-check` 检查 FFmpeg、FFprobe、Whisper 和模型，再重启桥接。视频解析不上传原始音轨给转写服务，但抽帧与转写文字会交给当前 Codex/Claude 模型。临时音频和字幕在完成或失败后清理；处理过程中可 `/状态` 查看抽帧或转写段数，或 `/取消`。视频下载超时为 5 分钟，每段转写超时为 10 分钟；长视频可能耗时较久。累计字幕上限 12 万字符，超限或失败的段落会明确标记缺失，其余段落继续处理。没有音轨时只看画面；组件缺失、超时或转写失败时明确说明本次只分析画面，不假装已听懂。微信语音消息保持原规则：只用微信附带文字，没有文字就提示重发文字。

## PDF、Office 与文本附件

支持直接发送 `.pdf`、`.xlsx`、`.docx`、`.pptx`，以及 `.txt`、`.md`、`.csv`、`.tsv`、`.json`、`.log`、`.yaml`、`.yml`、`.xml` 文件（单份最大 20 MB，合并任务最多 4 份）。收到后提取文字、表格、单元格和公式供当前引擎阅读；你可以再发送“汇总销售额”“修改这份文档”“调整第三页文案”等任务。Codex 和 Claude 都可以使用独立 Python 环境中的 openpyxl、python-docx、python-pptx、pypdf 编辑或生成文件，工具执行仍遵守原审批规则。

PDF 与 Office 首次使用需安装 Python 3（建议 3.10+），然后在本机执行以下命令；纯文本附件不需要 Python：

```sh
wx-agent office-setup
wx-agent office-check
```

Windows 使用 `wx-agent.cmd`，Python 须加入 PATH。安装命令创建用户数据目录中的独立环境，不修改系统 Python 包；需要网络下载依赖。可用 PYTHON_BINARY 指定创建环境的 Python，可用 WX_OFFICE_PYTHON 指定已有且包含上述库的 Python（office-setup 会在指定环境安装依赖）。

输入原件与提取文字保存在当前工作区的 `wx-agent-input` 下，每次创建独立目录；结果另存到 `wx-agent-output`。这些文件会保留，用户可按需清理。微信发送 `/文件` 查看结果，发送 `/文件 文件名.xlsx`（或 PDF/Office/上述文本格式）回传文件；仅允许输出目录中的受支持普通附件文件，不允许目录穿越、符号链接、硬链接或大于 20 MB 的结果。未确认发送成功时不会自动重发。

暂不支持旧版 `.xls/.doc/.ppt`、宏文件、加密文档和未列出的附件格式，请先转换为支持的格式。解析还限制解压总量 80 MB、条目数 5000、单条目 16 MB，以避免异常压缩文件。大文档只提取部分内容，模型需要时可读取原文件。

提取内容不等于可视化预览：图表、嵌入图片、复杂版式不保证完整识别；Excel 公式由库保留/编辑，但不会像 Excel 那样重新计算。修改后的复杂样式或特殊对象需要用户在 Office 中复核。桥接不自动执行宏，不跟随外部链接；模型处理文件仍需遵循审批。文件内容和提取文字会提交给选中的模型服务。

## PDF 与文本附件

PDF 提取文字层并标注原页码，最多前 200 页、30000 字符；达到限制会明确提示截断。安装 OCR 组件后，对没有文字层的页补充本地识别（最多 20 页、30000 个 OCR 字符）；有文字层但含扫描图片的混合页不会自动补识别。OCR 不保留版式，不能保证图表和图片细节完整；失败或未处理页面明确标记。加密或损坏 PDF 会拒绝解析，请先提供未加密版本。可让模型按页总结、提取信息，或使用 pypdf 合并、拆分等；具体文件操作仍遵循审批。

文本文件支持 UTF-8、带 BOM 的 UTF-16 和 GB18030 解码，最多提取 30000 字符，不执行文本中的代码。TXT/Markdown/CSV/JSON 等仅按文本读取，不保证已验证结构或格式。原文件保留在独立用户工作区，处理结果可通过 `/文件 文件名.pdf` 或 `/文件 result.md` 等命令取回。

旧版本升级后，PDF/Office 用户请再运行一次 `wx-agent office-setup` 安装 pypdf，再用 `wx-agent office-check` 验证。文本附件不依赖 Python。

## 网页链接分析

在微信发送 `总结这个网页：https://example.com/article`，或一次给出最多 3 个链接进行比较。桥接读取静态网页正文并交给当前 Codex / Claude，回答标注来源。直接发送链接时默认概括内容。

支持公网 HTTP/HTTPS 的 HTML、纯文本、Markdown；每页最大 2 MB，提取最多 20000 字符，最多 5 次重定向。可 `/状态` 查看读取进度，`/取消` 中止。网页资料仅用于分析，不作为可执行指令。不会携带微信凭据、浏览器 Cookie 或登录状态，不读取本机及内网地址。网页读取使用直连，不复用引擎代理，以便校验并固定公网连接地址。

需要登录、验证码、JavaScript 渲染的页面（部分公众号和动态网站）可能只能提取部分内容或读取失败；失败时明确说明，可改发正文或截图。PDF、视频等下载链接不在网页解析范围内。

## 本地 OCR

截图会同时提供原图和 OCR 文字给模型；扫描 PDF 在文字层提取后补充无文字页的 OCR。识别在本机完成，结果随任务提交到选中的模型。未安装组件时，截图仍能走原有模型看图能力；PDF 明确提示缺少 OCR，不编造内容。

1. 安装 Python 3.10 或以上版本和 Tesseract。macOS：`brew install tesseract`；Ubuntu：`sudo apt install tesseract-ocr`。Windows 按 [Tesseract 官方安装指南](https://tesseract-ocr.github.io/tessdoc/Installation.html) 安装并加入 PATH。
2. 运行 `wx-agent ocr-setup`：安装 pypdfium2、Pillow，自动下载固定版本官方 `chi_sim`、`eng` 模型并校验 SHA-256。模型保存在数据根目录 `ocr-tessdata`，多个用户共用。
3. 运行 `wx-agent ocr-check` 验证。`TESSERACT_BINARY` 可指定程序路径；`WX_OCR_TESSDATA` 可指定已有语言包目录，设置后不自动下载模型。

OCR：单张输入最多 2000 万像素，渲染最长边 3000 像素，每页识别最多 30 秒。每份 PDF 最多尝试 20 个无文字页，补充文字最多 30000 字符；截图 OCR 总文字最多 30000 字符。识别可能有错漏，手写、表格、复杂排版请核对原件。

实现依据：[Tesseract 文档](https://tesseract-ocr.github.io/tessdoc/Home.html)、[pypdfium2 API](https://pypdfium2.readthedocs.io/en/stable/python_api.html)。

## 自动回传结果

成功完成的任务会自动发送本次在 `wx-agent-output` 新增或内容发生变化的受支持结果文件，最多 5 份、每份 20 MB。旧文件、内容未变文件、链接、失败或取消任务的产物不会自动发送。更多文件可以 `/文件` 查看，再 `/文件 文件名` 取回。

回传过程中仍占用当前任务；回传结束后才开始后续任务。文件上传/发送未确认时不自动重试，避免重复发送；确认未收到后可手动取回。输出目录超过 500 项或累计 100 MB 时暂停该次自动回传并提示整理，手动取回仍可使用。请保留不同用户独立工作区，不要由其他进程同时修改输出文件。
