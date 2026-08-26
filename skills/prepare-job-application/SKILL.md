---
name: prepare-job-application
description: Use when tailoring application materials, drafting a cover letter or answers, preparing form fields, building an evidence matrix, or reviewing a job application prefill.
---

# Prepare Job Application

Create a useful, reviewable application packet without inventing facts or submitting anything. Require a current `$audit-job-application` result tied to the official source; if it is missing or stale, audit first.

## Prepare grounded materials

Produce these review artifacts from the audit and resume evidence:

- A requirement-to-resume evidence matrix: requirement and locator, supported resume evidence, gap/unknown, and user action needed.
- Resume bullet suggestions as factual diffs (`- current` / `+ proposed`); do not add unsupported outcomes, tools, dates, or scope.
- A tailored cover-letter draft and requested-answer drafts using only supported claims. Mark gaps for confirmation instead of asserting them.
- An attachment checklist that separates required, conditional, unavailable, and unknown items; mark a portfolio as `unknown` unless a current user-provided link supports it.

## Build the field ledger and packet

List every audited form field with a value state (`supported`, `unknown`, or needs confirmation) and the core classification:

- `safe`: only known, user-approved contact/identity values and an existing resume/link; do not fill an unknown portfolio.
- `confirm`: salary, availability, visa/work authorization, sponsorship, relocation, and every unsupported or ambiguous job-related value. Ask before using any value.
- `manual_only`: EEO/demographic, disability, veteran, consent, signature, CAPTCHA/MFA, and final submit. Keep values blank and tell the user to complete them personally.

Use `application_packet_upsert` to save a `draft` with the reviewed field list; let the core assign classifications. Include no guessed values or sensitive answers. After the user reviews the materials and fields, call `application_packet_review` only to mark the packet ready for prefill. This records readiness, never submission.

## Browser and submission boundary

Browser assistance is visible and begins only after the user requests it. Use browser prefill only for the exact allowlisted hosts in `application-safety.md`, after a current audit and only for non-sensitive reviewed values; show each proposed value and stop before review/submit. For LinkedIn, Indeed, Workday, company-owned unknown domains, or any other domain, provide a field-by-field copy table instead. Never log in, reuse cookies, solve CAPTCHA/MFA, enter consent/signature, send anything, or press final submit.

State the packet status, user decision needed, and unresolved facts. The user separately records an actual application after manual submission. Read [application-safety.md](../../references/application-safety.md) and [trace-fields.md](../../references/trace-fields.md) for domain and privacy rules.
