# Ranking and feedback policy

Evaluate hard eligibility before soft fit. State each requirement as `eligible`, `ineligible`, or `unknown`; unknown is not a pass or a rejection. Explain the evidence or missing information separately from fit.

Soft match is a 0–100 score only for a confirmed profile. Show the score factors plus reasons, gaps, and unknowns; never emit an unexplained score.

Record user feedback with `feedback_record` using the applicable disposition: `interested`, `later`, `rejected`, `information_error`, `closed`, or `applied`. Corrections and closed signals do not change preferences. Only after a repeated feedback pattern, propose a new preference/search brief and obtain explicit confirmation; preserve old runs against their original versions.
