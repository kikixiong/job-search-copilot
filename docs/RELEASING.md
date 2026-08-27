# 发布流程（Releasing）

版本 `0.1.0` 的发布是本地 artifact 生成流程，不自动创建 GitHub repository、remote、push、npm publish 或 personal marketplace 安装。

## 本地门禁

在干净工作树和 Node `>=22.13.0` 环境执行：

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
npm run validate:sbom
npm run release:smoke
git diff --check
```

另外运行 Codex 随附的 plugin validator 与五个 skill quick validators。Linux workflow 的 `actions/checkout`、`actions/setup-node` 必须固定到经各自官方 v4 tag 只读核验的完整 40-character commit SHA，并保留 `# v4` 注释；本地 config validator 拒绝浮动 tag。Sensitive scan 只读取 `git ls-files`；`.test` 文件只对明确的单个 synthetic placeholder 例外，不能用一个 marker 跳过同文件中的 secret、private key、主目录或真实联系方式。不要让脚本扫描 untracked 个人目录。

`release:package` 只从精确的 tracked 文档/manifest 与 `git ls-files -- skills references` 构造 stage，再加入明确生成输出；plan 外 archive entry 会使打包失败。esbuild metafile inputs 与 Vite/Rollup module IDs 同时经过 provenance gate：repo-local 文件必须 git tracked；只精确放行 virtual/generated pseudo IDs 与 `node_modules`，untracked transitive import 必须失败。它生成自包含 plugin directory、`.tgz`、CycloneDX 1.6 SBOM、完整第三方 production dependency copyright/license/NOTICE 报告、NOTICE 与 `SHA256SUMS`。`validate:sbom` 使用随 lockfile 安装的 CycloneDX 官方 library/schema，不在 CI 下载 schema。归档固定排序、uid/gid、mode 与 mtime；同一源码和 lockfile 只做一次重复生成 hash 比较，确认后保留第二次的最终 artifacts。不要给普通源码做 hash 门禁。

## 安装与 smoke

Smoke 把最终 `.tgz` 解压到 checkout 外的系统临时目录，确认插件根目录到文件系统根之间不存在 `node_modules`，并不给子进程传 `NODE_PATH`。它从任意 caller cwd 读取解压副本的 `.mcp.json`，以插件根目录解析其 `cwd: "."`，初始化 stdio MCP、确认恰好 12 tools，并分别导入合成 PDF、DOCX、TXT、Markdown；随后检查 Viewer token exchange、未认证 API 401、认证 snapshot 200、HTML/CSP 和每个相对静态 asset 200。临时解压目录在 `finally` 中安全删除。

本地 marketplace 安装方式遵循 OpenAI 官方 [manual local plugin 指南](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)。发布检查不得自行写入个人 marketplace；如需安装 smoke，必须由人明确批准并在完成后手动管理该副本。

## 平台状态

macOS 是本项目完整本地门禁与打包 smoke 的已执行平台。Linux 使用 GitHub Actions、Node 22.13.0 和 `npm ci` 支持。release containment 使用共享 `path.relative` 语义并由 `path.win32` 单元测试覆盖；Windows 尚未做端到端 release smoke，因此只声明路径兼容，不声明完整支持。

## 人工发布批准

在任何 public remote、push、GitHub Release、marketplace 提交或 npm publish 前，负责人必须检查最终 diff、SBOM、许可证报告、敏感扫描、`SHA256SUMS`、artifact smoke 和 release notes，并给出单独、明确的人类批准。没有批准就停在本地 `release/`。
