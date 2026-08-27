# Baseline scenario: research-job-opportunities

## Observed baseline behavior

- Correctly refused to label synthetic social/aggregator leads as currently open.
- Still assigned 78/100 and 74/100 scores without any confirmed candidate profile or factor evidence.
- Did not distinguish official, aggregator, recruiter-social, and community evidence states.
- Omitted retrieval timestamps, the official 403 failure, canonical/dedup decisions, eligibility unknowns, and a search-run summary.

## Failure the skill must correct

Require a confirmed profile and versioned search run before scoring; record source tier, retrieval/failure evidence, official verification result, dedup/canonical data, hard eligibility, score factors/gaps/unknowns, and a visible run summary. Social-only leads remain `community_lead` or `official_lead` as supported, never `verified_open`.

## Evidence metadata

- Type: baseline observed before implementation.
- Skill commit: `6f476cf`.
- Sequence: baseline → skill commit → controller forward-test PASS → next skill.
