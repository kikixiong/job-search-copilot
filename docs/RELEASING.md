# 发布流程（Releasing）

版本 `0.1.0` 的发布是本地 artifact 生成流程，不自动创建 GitHub repository、remote、push、npm publish 或 personal marketplace 安装。

## 本地门禁

在干净工作树和 Node 22 环境执行：

```bash
npm ci
npm run validate
npm run lint
npm test
npm run typecheck
npm run build
npm run scan:sensitive
npm run audit:prod
npm run release:package
npm run release:smoke
git diff --check
```

另外运行 Codex 随附的 plugin validator 与五个 skill quick validators。Sensitive scan 只读取 `git ls-files`，测试用 secrets 只允许出现在明确的 `.test` 合成 fixtures；不要让脚本扫描 untracked 个人目录。

`release:package` 生成自包含 plugin directory、`.tgz`、CycloneDX 1.6 SBOM、第三方 production dependency 许可证报告、NOTICE 与 `SHA256SUMS`。归档固定排序、uid/gid、mode 与 mtime；同一源码和 lockfile 只做一次重复生成 hash 比较，确认后保留第二次的最终 artifacts。不要给普通源码做 hash 门禁。

## 安装与 smoke

从任意 caller cwd 读取 staged `.mcp.json`，以插件根目录解析其 `cwd: "."`，初始化 stdio MCP 并确认恰好 12 tools。随后建立合成 workspace，检查 Viewer token exchange、未认证 API 401、认证 snapshot 200、HTML/CSP 和每个相对静态 asset 200。Release bundle 不得依赖 `node_modules`。

本地 marketplace 安装方式遵循 OpenAI 官方 [manual local plugin 指南](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)。发布检查不得自行写入个人 marketplace；如需安装 smoke，必须由人明确批准并在完成后手动管理该副本。

## 平台状态

macOS 是本项目完整本地门禁与打包 smoke 的已执行平台。Linux 使用 GitHub Actions、Node 22 和 `npm ci` 支持。代码包含 Windows 数据路径和无 shell opener 参数，但 Windows 尚未做端到端 release smoke，因此只声明路径兼容，不声明完整支持。

## 人工发布批准

在任何 public remote、push、GitHub Release、marketplace 提交或 npm publish 前，负责人必须检查最终 diff、SBOM、许可证报告、敏感扫描、`SHA256SUMS`、artifact smoke 和 release notes，并给出单独、明确的人类批准。没有批准就停在本地 `release/`。
