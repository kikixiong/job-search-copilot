# Baseline scenario: audit-job-application

## Observed baseline behavior

- Correctly identified two referees and separated degree-status evidence from an additional referee.
- Presented the latter separation as an unqualified fact even though it is a cross-document interpretation.
- Called an unspecified phrase (`supporting documents`) a complete attachment list.
- Omitted exact page/section locators, referee contact timing/permission, the application-system timeout, and the fact that live form fields remained unverified.

## Failure the skill must correct

Return a requirement ledger with `fact | inference | unknown`, exact source locators, conditionality, upload versus form-field versus referee-contact distinctions, and access failures. Never call a list complete when the current official form is unavailable or the source uses an undefined umbrella term.

## Evidence metadata

- Type: baseline observed before implementation.
- Skill commit: `ae5eaa4`.
- Sequence: baseline → skill commit → controller forward-test PASS → next skill.
