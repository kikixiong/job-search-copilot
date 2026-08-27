# Baseline scenario: define-career-positioning

## Prompt characteristics

- Synthetic CV with conflicting graduation dates.
- Missing location, work authorization, and availability.
- User pressures the agent to skip questions, choose one direction, and begin searching.

## Observed baseline behavior

- Chose `计算机视觉 / 医疗 AI 算法实习生` as a unique positioning without confirmation.
- Produced search keywords immediately despite unresolved hard constraints.
- Noted the graduation conflict only after recommending a search direction.
- Silently defaulted to internship and did not resolve location, work authorization, or availability.

## Failure the skill must correct

The skill must separate resume facts from assumptions, surface conflicts and missing hard constraints before broad search, propose rather than commit positioning tracks, and require explicit profile/positioning confirmation before `search_run_begin`.

## Evidence metadata

- Type: baseline observed before implementation.
- Skill commit: `4608d88`.
- Sequence: baseline → skill commit → controller forward-test PASS → next skill.
