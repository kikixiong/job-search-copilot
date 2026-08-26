# Job Search Copilot

面向中文技术岗位与实习求职者的本地优先（local-first）Codex 插件。它把定位、公开职位研究、证据核验、反馈迭代和申请材料准备串成可恢复的工作流；核心主张是“线索不是事实，草稿不是提交”。

## 隐私边界

SQLite、简历副本、附件与导出默认保存在本机，不设中央后端、遥测或自动 exporter。**本地保存不等于本地模型推理**：当你让 Codex 分析简历时，完整简历文本可能由当前 Codex 模型处理，并受你所用产品、账户和组织的数据政策约束。请在上传前确认这些政策，并尽量避免在搜索查询中放入联系方式、证件号或其他无关 PII。详见 [PRIVACY.md](PRIVACY.md)。

## 它如何工作

Skills 负责对话流程与来源纪律，Codex Web/Browser 读取允许访问的公开页面，12 个 MCP tools 把结构化状态写入 `JobSearchService` 与 SQLite；Viewer 只在 `127.0.0.1` 上提供带一次性 token 和独立 session cookie 的本地审阅界面。完整边界见 [架构说明](docs/ARCHITECTURE.md) 与 [来源政策](docs/SOURCE_POLICY.md)。

五个 skills：

- `$define-career-positioning`：导入简历、核对事实并确认目标定位。
- `$research-job-opportunities`：按已确认版本研究、去重、核验与排序职位。
- `$audit-job-application`：重新打开当前官方来源，列出申请要求与未知项。
- `$prepare-job-application`：生成可审阅的证据矩阵、文书草稿和字段清单。
- `$run-job-search-loop`：从持久化版本恢复并编排完整反馈循环。

## 三个起步工作流

1. “上传简历，帮我先明确求职定位并确认目标岗位。”
2. “按我已确认的定位搜索并核验当前 Top 20 岗位。”
3. “使用 `$run-job-search-loop` 根据我的反馈重新搜索，并为选中的岗位准备申请材料。”

Viewer 展示候选人定位、机会对比、全部证据/冲突、trace 与申请 packet。它可以给出受审阅的字段指导或逐字段复制 fallback，但没有最终提交、登录、消息、邮件、Cookie 导入、CAPTCHA/MFA 绕过或同意/签名能力。用户始终手动完成敏感字段和最终提交。

支持最大 20 MiB 的文本型 PDF、DOCX、TXT、Markdown（`.md` / `.markdown`）简历；扫描件需先 OCR。导出支持 JSON、Markdown 和 CSV，写入对应 workspace 的 `exports/`；JSON 可显式包含脱敏 recovery snapshot。

## 要求与源码安装

- Node.js `>=22.13.0`（`node:sqlite` 无需实验参数的最低版本）
- npm 10 或更高版本
- 支持 Plugins 的 Codex / ChatGPT desktop surface

```bash
npm ci
npm run build
npm test
```

源码根目录本身就是插件目录。开发时可按 OpenAI 官方的 [local/repo marketplace 指南](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)把该目录接入本地 marketplace；本仓库不会替你修改个人 marketplace。

## 打包插件

```bash
npm run build
npm run release:package
npm run release:smoke
```

`release/job-search-copilot/` 是无需 `npm install` 的自包含插件，`.tgz`、CycloneDX SBOM、第三方许可证报告、NOTICE 与 `SHA256SUMS` 位于 `release/`。解压 `.tgz` 后，将其中 `job-search-copilot/` 作为 local marketplace 的 plugin path；`.mcp.json` 从插件根目录相对启动 `dist/mcp/index.js`。公开发布前必须遵循 [RELEASING](docs/RELEASING.md) 的人工批准门禁。

## 开发命令

```bash
npm run validate        # plugin 配置、合成 fixtures、5 个 skills 与引用
npm run lint            # 非变异 ESLint
npm test                # 完整测试
npm run typecheck       # TypeScript project references
npm run build           # Node 输出与 Vite Viewer assets
npm run scan:sensitive  # 只扫描 git tracked files
npm run audit:prod      # production dependency audit
```

贡献规范、合成 fixture 要求和 DCO-style signoff 见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## Roadmap 与非目标

Roadmap：更多可解释的匹配维度、可选的用户自定义来源策略、Windows 原生端到端验证。非目标：中央 SaaS、招聘平台爬虫、绕过访问控制、自动投递、自动消息/邮件、账号托管或把社交线索冒充为官方在招事实。

计划上游：<https://github.com/kikixiong/job-search-copilot>。当前项目与 LinkedIn、Indeed、Workday 或任何 ATS/招聘平台没有合作或背书关系。

Copyright 2026 Jiaqi Xiong. Licensed under [Apache License 2.0](LICENSE).
