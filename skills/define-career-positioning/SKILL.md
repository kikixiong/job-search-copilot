---
name: define-career-positioning
description: Use when importing a CV or resume, analyzing career direction, choosing roles to target, or resolving conflicting candidate facts before a job or internship search.
---

# Define Career Positioning

Create a confirmed, evidence-backed targeting brief before any opportunity search. A request to “just choose” or “start searching” is not confirmation and does not permit guessing hard constraints.

## Import and inspect

1. Open or reuse the local workspace with `workspace_open`. Before receiving a file, disclose: the file is persisted locally in that workspace and its full resume text may be processed by the current Codex model.
2. With the user's agreement, import the supplied file only through `resume_import`. Do not copy it, write files directly, or access SQLite.
3. Build a concise fact ledger from the imported resume. For every material item, show its source location and mark it as `fact`, `contradiction`, `low confidence`, or `unknown`. Do not manufacture facts.

Treat location, graduation date, availability window, work authorization, compensation, and job-versus-internship status as unknown unless the user or source explicitly establishes them. Surface conflicts (for example, two graduation dates) before recommending a direction.

## Resolve the decision-critical gaps

Ask a single grouped set of only the unanswered high-impact questions:

- Job or internship (or both), employment type, target roles, level, domains, and target locations
- Availability/start window, timing, work authorization, and visa/sponsorship facts for those locations
- Hard exclusions, including compensation only if it is a real exclusion, plus the intended search breadth (`quick`, `balanced`, or `deep`)

Do not create search terms, call `search_run_begin`, or choose a unique track while a contradiction or decision-critical hard constraint remains unresolved. If the user declines to answer, retain `unknown` rather than defaulting from the resume or pressure.

## Propose, then confirm

Offer a **Positioning Brief** with one primary track and no more than two adjacent tracks. Each track includes target roles, resume evidence, material gaps or unknowns, and exclusions. Keep recommendations proportional to the evidence; label tentative reasoning as a proposal, not a candidate fact.

End with an explicit approval question. Only after the user confirms the brief, call `profile_commit` with the current base version and a profile containing supported `headline`, `skills`, `positioningTracks`, and one complete version-1 `targetingConstraints` object. That strict object records `status`, target kinds, employment types, levels, domains, availability, work authorization, visa, timing, hard exclusions, breadth, unknowns, and contradictions. Use `confirmed` only when at least one target kind is selected and no contradiction remains; use `unknown` with explicit `unknowns`, or `contradiction` with explicit field/details entries. Never omit a decision-critical gap or invent a default.

The profile owns the latest reusable positioning facts. A later search still requires a separate, user-directed `SearchBrief` containing a full `targetingConstraints` snapshot; that run snapshot may select a different confirmed breadth but must not silently reinterpret the profile. Report the resulting profile version and the exact status of its constraints.

## Guardrails and trace

- Use only the existing MCP tools (`workspace_open`, `resume_import`, and `profile_commit`) for workspace/profile persistence; never invent tool names or write database/files directly.
- Keep the user-visible trace to evidence locations, facts/unknowns, questions, proposed tracks, approval, and committed version. Do not expose hidden reasoning or unnecessary resume text.
- A confirmed profile authorizes neither a search nor an application action.

For shared evidence tiers and trace/PII limits, read [source-and-evidence-policy.md](../../references/source-and-evidence-policy.md) and [trace-fields.md](../../references/trace-fields.md).
