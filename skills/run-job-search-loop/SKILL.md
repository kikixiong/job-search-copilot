---
name: run-job-search-loop
description: Use when a user requests the complete resume-to-application job-search workflow, feedback-driven re-search and application preparation, or needs to resume an interrupted, confirmed job-search project.
---

# Run Job Search Loop

Orchestrate only the confirmed positioning → search → evidence review → feedback → confirmed new search → application audit/preparation loop. Recover work from persisted MCP state, never from markdown scratch notes or assumptions.

## Recover and report the current phase

Open the named workspace with `workspace_open`, then call `workspace_export` with `format: "json"` and `includeContent: true`. Recover only from its returned redacted structured snapshot (latest profile/tracks and targeting constraints, each run's immutable SearchBrief constraints, structured query attempts/failures, preference, run IDs/status, feedback, packet review metadata, and opportunity summaries); never read the exported file, database, or scratch notes directly.

At every phase boundary, show a compact status block:

- workspace name/ID; profile, search-brief, preference, and run versions/IDs; targeting-constraint schema/status
- current phase and completed action
- next user decision required
- recoverable failure or unknown, with the action to retry or resolve it

If a version is unavailable from persisted results, label it `unknown` and obtain it through the relevant MCP workflow rather than guessing.

## Run the gated phases

1. Use `$define-career-positioning` to import evidence, resolve constraints, propose tracks, and obtain a confirmed `profile_commit`.
2. Use `$research-job-opportunities` only from that confirmed profile; begin a new versioned run, verify evidence, and finish it.
3. Review evidence and collect feedback with `feedback_record`. Explain that corrections or closed items do not silently change preferences.
4. For a selected opportunity, use `$audit-job-application`, then `$prepare-job-application`; preparation remains review/copy support and the user manually submits.

## Treat scope changes as new confirmed versions

When the user changes target kind, role, location, level, domain, employment type, availability, work authorization/visa, timing, hard exclusions, or breadth, label existing results as based on their old profile/SearchBrief constraint snapshot. Do not reinterpret or mix observations, matches, dedupe decisions, or query outcomes across run IDs. Return to positioning when reusable facts changed, obtain explicit confirmation and a new profile version, then start a new confirmed search run with its own complete snapshot. A new preference version likewise requires the user's explicit confirmation after a repeated feedback pattern.

Every refresh is explicitly user-triggered and becomes a recorded new run. Do not configure daily refreshes, background monitoring, scheduled searches, notifications, or autonomous follow-up.

## Boundaries

Do not drift into full resume production, outreach, recruiting messages, email, or unrelated career consulting. Use only existing MCP tools; never invent tools or expose hidden reasoning. Keep visible traces to actions, evidence, versions, decisions, and recoverable failures. Read [trace-fields.md](../../references/trace-fields.md), [ranking-and-feedback.md](../../references/ranking-and-feedback.md), and [application-safety.md](../../references/application-safety.md) when their phase applies.
