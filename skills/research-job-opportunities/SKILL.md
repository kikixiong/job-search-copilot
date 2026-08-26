---
name: research-job-opportunities
description: Use when finding, searching, refreshing, verifying, comparing, or shortlisting job or internship opportunities.
---

# Research Job Opportunities

Research opportunities as a user-triggered, versioned evidence run. A lead is not an open job merely because a social or aggregator page displays it.

## Start only from confirmed scope

Require the workspace ID, confirmed profile version, and current targeting constraints. If the user has no confirmed profile, return to `$define-career-positioning`; do not score, shortlist, or call `search_run_begin`.

Confirm the requested breadth: quick (10), balanced (20, default), or deep (50). Plan queries across role, location, level, domain, employment type, timing, exclusions, and relevant synonyms. Call `search_run_begin` before browsing, bound to the confirmed profile version and search brief.

## Find, verify, and record

Search public official careers pages and public ATS first. Treat indexed public company, recruiter, community content, and user-provided social URLs, text, or screenshots as discovery leads only. Do not log in, reuse cookies, bypass access controls, or scrape LinkedIn/Indeed.

For every query and lead, retain source tier, retrieval time, locator, canonical apply URL when found, lifecycle/status confidence, deadline, and conflicts. Re-open an official company or public ATS source to verify when possible. Record `timeout`, `blocked` (including 403), `limited`, or `missing` in the visible trace and use a permitted official alternative; never silently upgrade an unverified lead.

Use `search_record_batch` for each query/batch, including empty batches that document a completed failed lookup when appropriate. Let the core normalize and deduplicate; report canonical/alias or duplicate decisions rather than doing database/file work directly. Use only supported MCP tool names.

## Evaluate and close the run

Separate hard eligibility (`eligible`, `ineligible`, or `unknown`) from a 0–100 soft match. A score requires the confirmed profile and stated factors, reasons, gaps, and unknowns; do not assign black-box scores. Classify social-only leads as `community_lead` unless an independently retrieved primary source supports `official_lead`; neither is `verified_open` without current official open evidence.

Call `search_run_finish` and present found, deduped, verified, filtered, and failed counts, plus the run/profile/search-brief versions and recoverable failures. Use `feedback_record` for feedback. Closed/correction signals do not change preferences; propose a new confirmed preference or search brief only after a repeated pattern, never mutate an old run.

Read [source-and-evidence-policy.md](../../references/source-and-evidence-policy.md), [ranking-and-feedback.md](../../references/ranking-and-feedback.md), and [trace-fields.md](../../references/trace-fields.md) for the shared contracts.
