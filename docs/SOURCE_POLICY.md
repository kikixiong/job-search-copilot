# 来源与证据政策（Source Policy）

## 三层来源

| 层级 | 例子 | 能证明什么 |
| --- | --- | --- |
| Official / primary | 雇主 career page、公开 ATS 上的当前职位页 | 当前 open/closed、申请 URL、明确要求 |
| Public company lead | 公司新闻、公开团队页、公司拥有的其他页面 | 官方线索；不能自动证明职位仍开放 |
| Discovery / social | 搜索索引、LinkedIn/Indeed、招聘者或社区帖子、用户截图 | 发现候选职位；状态上限是 lead，需回到 primary 核验 |

每条 observation 记录精确 `runId`、URL、source tier、retrieved-at、精确 locator、open/closed/lead、confidence、明确 deadline、canonical apply URL、冲突 metadata 与结构化 dedupe decision。官方 closed observation 关闭职位；互相矛盾的官方证据必须显示 `conflict`，不能静默挑选有利结果。

## 平台边界

可读取公开可访问页面，但不登录、不导入 Cookie、不复用 session、不绕过访问控制、不解决 CAPTCHA/MFA，也不对 LinkedIn 或 Indeed 做自动抓取。Workday 和其他 ATS 的公开页面可作为只读证据；每次 query attempt 都记录 `success | no_results | timeout | blocked | limited | missing | error`、retrieved-at、精确 locator、source tier，以及失败状态所需的公开 code/summary，再尝试允许的官方替代来源。失败不会因后续成功而被覆盖。

“读取 ATS”与“代替雇主提交”是不同权限。插件可审计公开字段和准备草稿；它没有雇主授权的 submit 能力，也不会假设候选人的登录、同意、签名或 demographic answers。

## Prefill fail-closed allowlist

Reviewed guidance 只在以下条件全部成立时出现：职位为 `verified_open`；最新官方 observation 与 canonical destination 完全一致且无冲突；application audit 为 `verified`、版本为正、目标完全一致且不超过 24 小时；HTTPS hostname 精确等于 `boards.greenhouse.io`、`jobs.lever.co` 或 `jobs.ashbyhq.com`；所有非 `manual_only` 字段都有已审阅、非敏感 provenance。

Redirect、子域、lookalike、userinfo、敏感 query/fragment、LinkedIn、Indeed、Workday、公司自有未知域以及任何缺失/过期/冲突条件都降级为逐字段 copy。`manual_only` 始终包含 EEO/demographic、disability、veteran、CAPTCHA/MFA，以及中英文或 ATS 常见的 consent/条款同意、attestation、电子签名/签署、generic submit/apply-now 与 final submit。

## 时间与刷新

Retrieved-at 是证据时间，不是职位发布时间。执行搜索时应取得当前 official observation；在准备申请或声称“仍开放”前再次核验。ATS audit 的硬 TTL 为 24 小时；其他 observation 没有伪造的永久有效期，越接近 deadline 或用户行动，越应刷新。刷新只由用户触发，旧 observation 与冲突历史仍保留。
