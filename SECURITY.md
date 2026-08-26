# 安全政策（Security）

## 支持版本

当前仅维护最新的 `0.1.x` 版本。安全修复不会自动回移到更早的开发快照。

## 报告漏洞

不要在公开 issue、日志或示例中粘贴真实简历、联系方式、token、Cookie 或申请材料。计划上游建立后，优先使用 GitHub Security Advisory 私下报告；在此之前，请通过项目所有者的 GitHub 个人页请求私密联系渠道。报告应包含合成复现、影响范围、版本与最小日志，不要测试不属于你的账号或系统。

## 运行边界

Viewer 只绑定 `127.0.0.1` 的 OS 随机端口。启动 URL 使用短期一次性随机 token，交换后跳转到不可预测的 session path；path handle 与 `HttpOnly; SameSite=Strict` cookie secret 相互独立。Host、mutation Origin 和 workspace/session 均 fail closed；静态资源设置 same-origin CSP 与 `nosniff`。

MCP 服务不收集账号密码或平台 secret。提交以下贡献会被拒绝：登录/账号托管、Cookie 导入或复用、绕过 robots/访问控制、CAPTCHA/MFA 绕过、隐藏抓取、自动接受同意/签名、自动发送消息/邮件，以及任何最终 submit automation。

依赖风险通过 Node 22.13.0 CI、production audit、CycloneDX SBOM、许可证门禁、tracked-file sensitive scan 和可复现 release package 检查。`SHA256SUMS` 只覆盖最终发布 artifacts，不代表第三方平台内容可信。
