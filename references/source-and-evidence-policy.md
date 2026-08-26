# Source and evidence policy

## Source tiers and statuses

| Tier | Use | Status ceiling |
| --- | --- | --- |
| Primary | Company career page or public ATS | `verified_open` only with a current open observation |
| Official lead | Other company-owned public source | `official_lead` unless it confirms current opening |
| Discovery | Public index, recruiter/social/community content, or user-provided social material | `community_lead` |

For each observation retain its run ID, URL, source tier, retrieved-at time, exact page/section or screenshot locator, lifecycle (`open`, `closed`, or `lead`), confidence, deadline if stated, canonical apply URL, conflict metadata, and auditable dedupe decision. A primary closed observation is `closed`; contradictory primary observations are `conflict`. Do not infer an opening from stale listings or visibility on a social platform.

## Permitted research

Search publicly accessible pages. User-provided URLs, text, and screenshots are discovery evidence, not authoritative status. Verify them against a primary source when possible.

Never log in, import/reuse cookies, bypass access controls, defeat CAPTCHA, scrape LinkedIn/Indeed, or automate private/restricted sources. Persist every query attempt with one of `success`, `no_results`, `timeout`, `blocked`, `limited`, `missing`, or `error`, plus retrieved-at, exact locator, source tier, and a public failure code/summary for failure outcomes. Try a permitted primary alternative without deleting the failed attempt.
