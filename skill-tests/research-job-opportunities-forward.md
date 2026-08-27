# Forward test: research-job-opportunities

## Result

PASS.

- Required a confirmed profile/workspace/version before `search_run_begin` or scoring.
- Refused to label social or aggregator leads as currently open.
- Classified the official 403 and missing official result as verification failures.
- Kept NovaVision and BioAgent as leads only and made no persistence, dedup, ranking, or score claims without the required profile.

## Evidence metadata

- Type: controller forward synthetic test after `6f476cf`.
- Sequence: baseline → skill commit → controller forward-test PASS → next skill.
