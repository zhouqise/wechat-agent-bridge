# 开发与贡献

[返回项目首页](../README.md) · [安装配置](setup.md) · [引擎与模型](engines.md) · [媒体与文件](media.md) · [运维与多用户](operations.md)

## 本地验证

需要 Node.js 22+，完整文档测试还需要 Python 及以下依赖（建议使用虚拟环境）：

```sh
python -m pip install openpyxl==3.1.5 python-docx==1.2.0 python-pptx==1.0.2 pypdf==6.20.1
npm ci --ignore-scripts
npm test
npm pack
```

打包使用明确的发布文件清单，排除凭据、工作区、日志和本地配置。源码发布也应使用经过检查的干净源码包，不能直接上传正在运行的整个文件夹。

测试覆盖来源校验、去重、上下文恢复、任务并发、取消、审批、RPC、锁和本机管理接口。详见 [安全说明](../SECURITY.md)。

协议依据：[腾讯微信协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol_zh_CN.md)（参考 2.4.10）及 [Codex App Server](https://learn.chatgpt.com/docs/app-server)。上游接口变化可能需要适配。

## 许可与反馈

采用 [MIT 许可证](../LICENSE)。欢迎通过 [Issues](https://github.com/zhouqise/wechat-agent-bridge/issues) 报告问题，请勿附带登录凭据、二维码或原始会话文件。`package.json` 中的 `private: true` 用于防止误发布到 npm，不影响 GitHub 开源或安装 Release 包。
