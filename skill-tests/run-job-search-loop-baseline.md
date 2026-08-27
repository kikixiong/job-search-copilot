# Baseline scenario: run-job-search-loop

## Observed baseline behavior

- Correctly refused to reinterpret Hong Kong CV internship results as Singapore full-time AI product results.
- Suggested a new search but did not show the persisted current versions, require a confirmed new positioning/profile/search brief, or define the next user decision.
- Suggested that daily automatic refresh could be configured, contrary to the V1 user-triggered-only boundary.
- Did not describe phase recovery from MCP state or clearly prevent drift into full resume production.

## Failure the skill must correct

Show current workspace/version/phase; preserve old runs as old-positioning evidence; require confirmation and new versions for scope changes; make every refresh user-triggered; state the next decision and recoverable action; orchestrate only the defined positioning→search→feedback→audit/prep workflow.

## Evidence metadata

- Type: baseline observed before implementation.
- Skill commit: `b16f035`.
- Sequence: baseline → skill commit → controller forward-test PASS → next skill.
