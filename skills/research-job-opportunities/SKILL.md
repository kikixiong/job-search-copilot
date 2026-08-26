---
name: research-job-opportunities
description: Use when finding, searching, refreshing, verifying, comparing, or shortlisting job or internship opportunities.
---

# Research Job Opportunities

Research opportunities as a user-triggered, versioned evidence run. A lead is not an open job merely because a social or aggregator page displays it.

## Start only from confirmed scope

Require the workspace ID, confirmed profile version, and recovered version-1 `targetingConstraints`. If the profile constraints are `unknown` or `contradiction`, return to `$define-career-positioning`; do not score, shortlist, or call `search_run_begin`.

Confirm the requested breadth: quick (10), balanced (20, default), or deep (50). Plan queries across role, location, level, domain, employment type, availability, work authorization/visa, timing, exclusions, and relevant synonyms. Call `search_run_begin` before browsing, bound to the confirmed profile version and a strict SearchBrief that contains keywords, locations, and the complete confirmed constraints snapshot. Treat that snapshot as immutable run scope.

## Find, verify, and record

Search public official careers pages and public ATS first. Treat indexed public company, recruiter, community content, and user-provided social URLs, text, or screenshots as discovery leads only. Do not log in, reuse cookies, bypass access controls, or scrape LinkedIn/Indeed.

For every query attempt, persist its query text/source, one outcome (`success`, `no_results`, `timeout`, `blocked`, `limited`, `missing`, or `error`), retrieval time, exact locator, source tier, and a public failure code/summary whenever the outcome is not `success` or `no_results`. For every observation retain its run ID, source tier, retrieval time, exact locator, lifecycle/status confidence, deadline, conflict metadata, canonical apply URL when found, and the auditable dedupe decision. Re-open an official company or public ATS source to verify when possible. Record access failures and use a permitted official alternative; never silently upgrade an unverified lead.

Use `search_record_batch` for each query/batch, including empty batches that document a completed failed lookup when appropriate. Let the core normalize and deduplicate; report canonical/alias or duplicate decisions rather than doing database/file work directly. Use only supported MCP tool names.

## Evaluate and close the run

Separate hard eligibility (`eligible`, `ineligible`, or `unknown`) from a 0–100 soft match. A score requires the confirmed profile and stated factors, reasons, gaps, and unknowns; do not assign black-box scores. Classify social-only leads as `community_lead` unless an independently retrieved primary source supports `official_lead`; neither is `verified_open` without current official open evidence.

Call `search_run_finish` exactly once and present found, deduped, verified, filtered, and failed counts, plus the run/profile/search-brief versions, immutable constraint snapshot, and recoverable failures. A completed or failed run is closed: never append a batch, trace, query, observation, match, or dedupe decision to it. Use `opportunities_query.runId` when reviewing historical assessments so a later run cannot replace its evidence or match identity. Use `feedback_record` for feedback. Closed/correction signals do not change preferences; propose a new confirmed preference or search brief only after a repeated pattern, never mutate an old run.

Read [source-and-evidence-policy.md](../../references/source-and-evidence-policy.md), [ranking-and-feedback.md](../../references/ranking-and-feedback.md), and [trace-fields.md](../../references/trace-fields.md) for the shared contracts.
