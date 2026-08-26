# Source and evidence policy

## Source tiers and statuses

| Tier | Use | Status ceiling |
| --- | --- | --- |
| Primary | Company career page or public ATS | `verified_open` only with a current open observation |
| Official lead | Other company-owned public source | `official_lead` unless it confirms current opening |
| Discovery | Public index, recruiter/social/community content, or user-provided social material | `community_lead` |

For each observation retain URL, source tier, retrieved-at time, exact page/section or screenshot locator, observed lifecycle (`open`, `closed`, or `lead`), deadline if stated, canonical apply URL, and conflicting observations. A primary closed observation is `closed`; contradictory primary observations are `conflict`. Do not infer an opening from stale listings or visibility on a social platform.

## Permitted research

Search publicly accessible pages. User-provided URLs, text, and screenshots are discovery evidence, not authoritative status. Verify them against a primary source when possible.

Never log in, import/reuse cookies, bypass access controls, defeat CAPTCHA, scrape LinkedIn/Indeed, or automate private/restricted sources. On `timeout`, `blocked` (including 403), `limited`, or `missing`, retain the attempted locator and retrieval time, state the failure, and try a permitted primary alternative.
