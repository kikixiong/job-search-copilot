# Task 4 report — local Viewer and application safety

## Outcome

Task 4 now provides a local-only Chinese evidence review desk backed exclusively by public `JobSearchService` methods. The MCP process owns one loopback Viewer launcher, `viewer_open` exchanges a one-use token for an isolated workspace session, and runtime UI serving uses only Vite-prebuilt static assets. The MCP surface remains exactly 12 tools.

The independent high-risk review of source commit `ab01fa4` reported 0 Critical, 6 Important, and 3 Minor findings. This focused fix resolves I-1 through I-6, M-1, and the requested M-3 behavior coverage. M-2 is intentionally deferred to Task 5's clean-checkout release pipeline; no second packaging mechanism was added here.

## Design system and Viewer behavior

| Token | Value | Use |
| --- | --- | --- |
| paper | `#F2F5F3` | flat local desk background |
| ink | `#10201C` | text and structural rules |
| teal | `#00A89A` | verified/current evidence |
| cobalt | `#315EFB` | selection and visible keyboard focus |
| amber | `#E9A23B` | unknown/review-needed state |
| coral | `#D85B55` | conflict/closed/manual-only state |

The four areas remain candidate profile, opportunity comparison, search provenance, and application preparation. The evidence rail is still the distinctive element rather than a generic dashboard: it shows every observation with source locator, state, and time; selects the latest official observation for the verified time; and explicitly retains conflict history. Search failures are associated only by exact persisted `runId`.

The application view now shows packet revision, official-page audit version/time/destination/status, attachments, unknowns, and each field's stable ID-backed provenance locator and review state. Clipboard buttons copy this real provenance guidance, never an answer or contact value. `manual_only` fields have no copy action. Confirm acknowledgements send the current packet revision and stable field IDs. Navigation supports native click plus explicit Enter/Space activation, visible focus, responsive stacking, and reduced motion.

No submit, login, consent, signature, CAPTCHA/MFA, browser extension, scheduling, cloud sync, messaging, or external-page control was implemented.

## Core and MCP invariants

- Schema migrations 5–6 add packet revision/audit/attachments/unknowns, stable field provenance, trace `run_id`, the per-packet unique field-key constraint, and safe cleanup of every historical non-empty `manual_only` value, including whitespace-only values.
- Negative `rejected`, `information_error`, and `closed` feedback requires a non-empty reason inside the service transaction. Viewer and MCP both call this same method; Viewer cannot pass a preference snapshot, so feedback does not implicitly change preferences.
- Packet upsert rejects duplicate keys and every non-empty `manual_only` value. Existing field IDs are preserved by key across packet revisions.
- Packet review rereads the packet inside the transaction, rejects stale revisions, rejects populated manual-only fields, and requires the exact current set of confirm-field IDs before atomically advancing to `ready_for_prefill` and the next revision.
- Packets store audit version/retrieved time/exact destination/status, attachment metadata, unknowns, and per-field source/locator/reviewed/sensitive provenance. Recovery and Viewer snapshots never return field values.
- Trace events persist an optional run ID, verify that it belongs to the same workspace, and expose it for exact run association.
- MCP schemas forward the new packet metadata and revision-bound review input while preserving the prior feedback disposition contract and exactly 12 public tools.

## HTTP routes and DTO boundary

After token exchange, all application/API paths are scoped beneath an unpredictable session path:

- `GET /s/<session>/api/snapshot`
- `POST /s/<session>/api/feedback`
- `POST /s/<session>/api/application/review`
- `GET /s/<session>/` and scoped SPA fallbacks for prebuilt static assets

There is no submit route. Unknown API routes return 404. Route handlers call only public `JobSearchService` methods and never import or open SQLite.

Every successful JSON response is independently projected through an explicit DTO allowlist. Feedback returns only `id`, `opportunityId`, and `disposition`; review returns only `id`, `status`, and `revision`. The snapshot explicitly maps every returned field. Trace output includes only structural metadata plus a fixed safe-field allowlist; arbitrary attribute containers are omitted.

Public URLs accept only HTTP(S), remove userinfo and fragments, and delete sensitive-name or sensitive-value query parameters while retaining ordinary public parameters. Free-text projection redacts email, phone, JWT, API-key/secret forms, file URLs, `/Volumes`, `/mnt`, `/srv`, other high-risk POSIX paths, Windows drive paths, and UNC paths. A high-risk path causes the whole free-text value to be omitted as `[REDACTED]` rather than risking partial disclosure.

## Session and ATS safety boundary

- The server binds only `127.0.0.1` on an OS-selected port.
- A random 32-byte launch token is one-use and short-lived. Exchange redirects to `/s/<random-32-byte-session>/`, removing the token from the URL.
- The `HttpOnly; SameSite=Strict` cookie is scoped to that exact unpredictable session path. The server requires the cookie value to equal the path session before resolving its workspace. Parallel workspace tabs therefore do not overwrite or cross-authorize each other.
- Host must exactly match the active loopback host/port; mutation Origin must exactly match its origin. Cross-workspace cookie/path mutations return 401 and hostile Host/Origin requests fail closed.
- Browser launch uses platform-specific argument arrays with `shell: false`; macOS, Linux, and Windows specifications are behavior-tested.
- Static responses use same-origin CSP and `nosniff`, with no remote runtime assets.

Reviewed ATS guidance is fail-closed. It requires all of the following: the packet is bound to the current opportunity; opportunity state is `verified_open`; latest official observation is open and its exact URL matches the canonical destination; packet audit is `verified`, positive-versioned, no more than 24 hours old, and matches the exact canonical destination; destination is HTTPS on the exact reviewed ATS host allowlist; and every non-manual field has reviewed, non-sensitive provenance. Missing, stale, conflicting, mismatched, sensitive, lookalike, HTTP, or unknown inputs use copy mode.

## Representative RED → GREEN evidence

1. Core feedback RED: all three negative dispositions were accepted without reasons. GREEN: service-level transactional reason invariant; Viewer and MCP regression tests pass.
2. Packet RED: manual-only values, duplicate keys, stale review, missing acknowledgements, and key-based acknowledgement were accepted. GREEN: non-empty values (including whitespace) reject, migration clears historical values, IDs remain stable, and review binds revision plus exact current field IDs.
3. HTTP RED: the opener behavior helper was absent, snapshots used recursive pass-through sanitization, and parallel sessions shared `Path=/`. GREEN: shell-free platform specs, explicit DTOs/redaction, unpredictable scoped paths/cookies, and crossed mutation rejection.
4. ATS RED: host-only matching displayed reviewed guidance without current audit metadata and still passed when the latest official URL differed. GREEN: exact destination, latest official observation, TTL, status, and field-provenance fail-close checks.
5. Evidence RED: the rail selected the first official observation and run failures were associated by timestamp; the app also read the wrong trace container. GREEN: latest official time, every observation/conflict, DTO `fields`, and exact `runId` association.
6. UI RED: negative feedback could be attempted without a visible reason gate, acknowledgements used mutable field keys, keyboard tests did not activate navigation, and provenance was placeholder copy. GREEN: reason gate, revision/stable-ID body, Enter/Space behavior, and real audit/provenance presentation.
7. Manual cleanup edge RED: whitespace-only manual values survived both upsert and migration. GREEN: any `value.length > 0` rejects and migration uses `value <> ''`.

The RED failures above were observed as behavior failures before the corresponding implementation. No configuration or prose source-text tests were added.

## Verification evidence

Focused development evidence:

- `npm run test:core`: 23/23 passed.
- MCP focused suite: 8/8 passed and asserted exact 12-tool preservation.
- Viewer focused suites: 16/16 passed (8 React behavior tests and 8 real HTTP/server tests).
- Additional targeted RED/GREEN runs covered whitespace manual-only cleanup and exact official-page URL fail-close.

Final evidence on the delivered source state:

- `npm test`: 47/47 passed, including config validation of two synthetic fixtures.
- `npm run build`: TypeScript project build and Vite production build passed. Static output: HTML 0.45 kB, CSS 10.37 kB, JS 211.06 kB (67.15 kB gzip).
- Built-output HTTP smoke: token exchange 303, token-free scoped static page 200, authenticated snapshot 200.
- `git diff --check`: passed.
- Forbidden-capability and Viewer SQLite import searches returned no source matches.

The earlier successful official plugin/skill validators and production dependency audit were reused because this focused fix did not change plugin manifests, skills, fixtures, or dependencies. Root `validate:config` was nevertheless rerun by both final test and build. The first final gate was invalidated by a late ATS exact-observation review improvement, so the affected test was run first and the complete final test/build/HTTP-smoke gate was then rerun once on the final code state.

## Review, skipped repetition, and residual risk

This was a high-risk service/schema/local-HTTP boundary. The implementation received one independent high-risk review at the milestone, then this focused self-review checked each I/M item, response projection, migrations, routes, forbidden capabilities, final diff, and current verification evidence. No subagent was used because Task 4 explicitly prohibited delegation.

Repeated full tests and builds were skipped during individual TDD cycles; only affected core/MCP/Viewer tests ran until the final gate. No hash gate was used because normal source/static changes do not require a deterministic integrity contract. M-2 remains explicitly assigned to Task 5's clean-checkout release pipeline.

Known residual risk is presentation/platform coverage: DOM/accessibility behavior, responsive state, reduced motion, and opener argument construction are automated, but no native screenshot pass or real Windows/Linux process launch was performed. Node 22 continues to emit its standard experimental warning for `node:sqlite`. No release, publish, remote, or external mutation action was performed.
