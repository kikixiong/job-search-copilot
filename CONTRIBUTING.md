# 贡献指南（Contributing）

欢迎小而完整的功能批次。先说明行为、边界和风险，再按模块提交；不要把一个改动拆成大量无独立价值的文件或流程。

## 开发约束

- 行为改动遵循 TDD：先写一个能说明真实错误的测试，观察预期 RED，再实现最小 GREEN 并整理。
- 只使用合成 fixtures。禁止提交真实简历、联系方式、申请文档、Cookie、token、私有截图或个人主目录路径。
- Skills 需同时做 baseline 与 forward 测试，保持简洁，并把共享 schema/确定性逻辑留在 MCP/Core。
- 来源、隐私、no-submit 和 application field 分级是公共安全边界；涉及这些边界时扩大到相关集成测试。
- 依赖必须有与 Apache-2.0 静态 bundle 分发兼容的许可证。门禁使用 SPDX parser 计算 `OR`、`AND` 与 `WITH`；GPL-only、LGPL-only、EPL、AGPL、SSPL、`NOASSERTION`、`UNLICENSED` 或未知表达式不得进入 production inventory，含明确 permissive 选项的 dual-license 可按该选项分发。

最小本地检查：

```bash
npm run validate
npm run lint
npm test
npm run build
npm run scan:sensitive
```

发布相关改动还要运行 `npm run audit:prod`、`npm run release:package` 与 `npm run release:smoke`。文案或静态说明无需为形式增加单测，但必须自检 diff 与链接。

## 贡献声明

提交应包含 DCO-style signoff，确认你有权按 Apache-2.0 提供该贡献：

```text
Signed-off-by: Your Name <synthetic@example.test>
```

使用 `git commit -s` 可自动加入该行。提交第三方代码或素材时必须说明来源、许可证及修改；不接受无法证明兼容性的复制内容。
