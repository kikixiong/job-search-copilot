# User-visible trace fields

Show action history, not hidden reasoning. Include workspace and version IDs; immutable targeting snapshot/status; query text/source/outcome; retrieved-at time; source tier, URL, and exact locator; lifecycle/status confidence and deadline; conflict metadata; structured canonical/dedup decision; eligibility and match explanations; failures; and run counts. Query attempts, observations, matches, dedupe decisions, and run-bound trace entries retain the exact run ID.

Exclude full resume text, credentials, cookies, access tokens, sensitive demographic information, and private contact details unless the user explicitly needs a minimal item shown. Before persistence, redact semantic `password`, `secret`, `credential`, `apiKey`, `privateKey`, and `session` paths as complete subtrees; apply public text/URL redaction again at recovery and Viewer boundaries. State `fact`, `inference`, or `unknown` where that distinction changes a decision.
