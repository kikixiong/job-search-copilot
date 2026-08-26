---
name: audit-job-application
description: Use when a candidate needs the current requirements for one job or internship application, including documents, referees, eligibility, deadlines, form fields, or application channel.
---

# Audit Job Application

Audit the current primary application source before advising on preparation. Do not turn a posting, a prior application, or an undefined phrase into a complete application checklist.

## Re-open the current source

Re-open the official posting and, when publicly available, its current application document/form. Use `opportunities_query` only to recover an existing saved opportunity; verify the live source with Browser/Web. Record the URL, retrieved-at time, and exact page, section, field label, or screenshot locator.

If a source or live form is unavailable, retain the attempted locator and `timeout`, `blocked`, `limited`, or `missing` evidence. Treat the best available result as `inference` and live fields as `unknown`; do not claim they were checked. Follow the shared public-source and no-access-bypass policy.

## Return the requirement ledger

Return these separate sections, with every row marked `fact`, `inference`, or `unknown`, and with condition, source locator, and short necessary quote where available:

| Section | Capture |
| --- | --- |
| Uploads | Named files and whether an undefined umbrella term leaves the list incomplete |
| Form fields | Current required/conditional fields; unverified live fields remain `unknown` |
| Referees | Number, role, contact timing, permission/notice needed, and any conditional trigger |
| Eligibility | Work authorization, degree/enrollment, location, experience, and unresolved conditions |
| Deadline | Date, time, timezone, and status of the source |
| Channel | Official URL/system, access state, and whether submission is available |

An academic-status proof establishes only the status it explicitly supports. It is not a comprehensive recommendation or a substitute for a referee unless the same current source explicitly equates them. Cross-document reconciliation is `inference` and must name both locators and the condition. Never call `supporting documents`, `additional materials`, or another undefined umbrella term complete.

## Boundaries and handoff

State facts before interpretations, and do not invent documents, references, permissions, dates, or form fields. Keep user-visible evidence and action history only; do not expose hidden reasoning or unnecessary personal data. Do not write files/databases or invent MCP tools. This audit does not prepare, prefill, contact referees, or submit an application; hand off preparation only after the user chooses it.

Read [source-and-evidence-policy.md](../../references/source-and-evidence-policy.md) and [trace-fields.md](../../references/trace-fields.md) for source, access-failure, and trace rules.
