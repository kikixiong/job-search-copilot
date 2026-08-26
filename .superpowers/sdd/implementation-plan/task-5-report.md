# Task 5 report — open-source release gate

## Outcome

Task 5 delivers a Chinese-first open-source surface and a local-only, reproducible release pipeline for Job Search Copilot `0.1.0`. The ignored `release/` output contains a self-contained plugin directory and portable `.tgz`; it requires Node 22 but no `npm install`. No remote, push, npm publish, GitHub repository, marketplace install, personal plugin install, or live job-board automation was performed.

## Documentation and platform contract

- Replaced the scaffold README with product thesis, local/model privacy distinction, architecture, requirements, source and packaged installation, three starter workflows, five skills, Viewer/exports/formats, no-submit boundary, commands, roadmap and non-goals.
- Added `docs/ARCHITECTURE.md`, `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/SOURCE_POLICY.md`, `docs/RELEASING.md`, and `NOTICE`.
- NOTICE explicitly states that no JobSync, Job Sentinel, JobSpy, or AIHawk source was copied and disclaims platform partnership.
- Local plugin installation wording follows the official OpenAI local/repo marketplace documentation; this task did not modify a personal marketplace.
- macOS is documented as locally exercised, Linux as Node 22 CI-supported, and Windows as path-compatible but not end-to-end supported.

## Automation, scanner, and packaging

- Added one Ubuntu GitHub Actions workflow using Node 22 and `npm ci`. It runs plugin/fixture/skill validation, non-mutating ESLint, focused Core and full tests, TypeScript/Vite build, tracked-file sensitive scan, production audit, release packaging/license/SBOM generation, and bundled smoke. It performs no live job search.
- Added ESLint 10 with TypeScript and React Hooks flat configuration; `npm run lint` has no write/fix flag.
- Added a `git ls-files` scanner for likely API keys/tokens/cookies, private keys, personal home paths, non-synthetic contact data, and binary application documents. `.test` exemption requires an explicit synthetic marker. Controlled tests cover every rejection class, public metadata, intentional synthetic fixtures, source/lockfile false positives, and the non-synthetic `.test` bypass.
- Added deterministic USTAR+gzip generation with sorted entries, fixed uid/gid/mtime/modes, esbuild single-entry Node bundle with only Node built-ins external, Vite relative static assets, CycloneDX 1.6 SBOM, production dependency license compatibility/report, NOTICE, and SHA256SUMS for final artifacts only.
- The staged plugin contains `.codex-plugin/plugin.json`, a plugin-root-relative `.mcp.json`, five skills plus their agents, four references, documents, license/notices, a single MCP entry bundle, Viewer assets, PDF.js worker/fonts/CMaps/WASM, SBOM, and license report.
- Release `.mcp.json` launches `dist/mcp/index.js` with `cwd: "."`; smoke runs from `/tmp`, resolves this against the installed plugin root, and does not rely on the repository caller cwd.

## TDD and focused evidence

Behavior scripts were written and observed RED before implementation:

1. Scanner tests failed because no tracked-file scanner existed; GREEN covers all named sensitive classes and controlled exceptions.
2. Release tests failed because deterministic tar, CycloneDX inventory, license gate, and release layout did not exist; all are GREEN.
3. MCP runtime test failed because release no-browser options did not exist; GREEN installs a no-op opener only under the explicit smoke environment.
4. Skill and static-asset validator tests failed before their scripts existed; both are GREEN.
5. First staged MCP smoke failed at startup with Mammoth's CommonJS `Dynamic require of "fs" is not supported`; root cause was the ESM bundle lacking a scoped `createRequire`, and the next smoke passed.
6. A new synthetic-PDF staged smoke then RED with missing bundled `pdf.worker.mjs`; GREEN includes the worker and PDF.js asset directories and uses bundle-relative asset URLs.
7. Scanner regression RED proved that a real-looking secret could hide in a `.test` file without a synthetic marker; GREEN requires both conditions.
8. Windows and root-account home-path fixtures RED against the first scanner; GREEN rejects both while keeping scanner source and synthetic security reports free of self-matches.
9. A named Markdown/JSON resume-artifact regression RED showed that contact-free text resumes were not rejected; GREEN blocks named text application artifacts unless they are intentional synthetic `.test` fixtures.

Focused runs on the affected states:

- Release/script tests: 11 behavior tests total in the final full suite; targeted script batch passed before the final gate.
- MCP: 11/11, including stdio entry, exact 12 tools, no browser launch, recovery/privacy and Viewer launcher behavior.
- Viewer: 19/19 React and real HTTP/security tests.
- Core: 25/25 after the PDF asset path change, including TXT/Markdown/PDF/DOCX import.
- Staged release smoke: exact 12 MCP tools, synthetic bundled PDF import, one-use Viewer token, unauthenticated snapshot 401, authenticated snapshot 200, CSP, and 2 relative static assets.

## Final clean-state gate

- Final `npm ci`: added 321 packages; audited 325; 0 vulnerabilities.
- Official plugin validator: passed.
- Official skill quick validators: 5/5 passed.
- Local plugin/fixture/skill validation: passed (2 synthetic JSON fixtures, 5 skills and references).
- `npm run lint`: passed, non-mutating.
- `npm test`: 66/66 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; Vite output was HTML 0.45 kB, CSS 10.37 kB, JS 210.24 kB (66.79 kB gzip).
- `npm run audit:prod`: 0 vulnerabilities.
- `npm run scan:sensitive`: passed after every deliverable, including this report, was staged and therefore visible through `git ls-files`.
- Generated SBOM/license inventory: CycloneDX 1.6 with 133 unique production components; license gate found no unknown, unlicensed, AGPL, or SSPL production package.

## Determinism and final artifact integrity

Exactly one unchanged-input repeat-generation comparison was performed after the release implementation was complete. Hashes of the `.tgz`, SBOM, license report, NOTICE, and generated `SHA256SUMS` matched across both runs. A later `git diff --check` pass normalized trailing blank lines in release documentation, so the final artifact was generated once more without performing a second determinism comparison; the generator code and dependency inputs did not change.

Final artifact hashes:

```text
89be6f29d1565db9ba1027dfade0a74ba32854fbe7bb93b0deb46df1126b8754  job-search-copilot-0.1.0.tgz
a8b9569dd8badbbaee73e4804fe78301f3f158e9c2886e3e464419d09fe31abb  job-search-copilot-0.1.0.cdx.json
72b30c8f4dfd80ec30c8a947aa461743f245c0cbf32175fa54c36a09b1a7f2db  job-search-copilot-0.1.0-licenses.md
6ac78bad43a07d362231d8e2affac83d1fca62bdcfbeb3b942e025b2558849ec  NOTICE
```

The portable plugin archive is 3,196,209 bytes and needs no install step after extraction.

`shasum -a 256 -c release/SHA256SUMS` passed for all four final artifacts. No ordinary source, style, test, or documentation file was hashed.

## Review, skipped repetition, and residual risk

The implementer performed one whole-change requirements/diff/status review. No independent agent was started because Task 5 explicitly prohibited subagents and the plan assigns independent whole-change review to the controller.

Repeated full tests/builds were skipped during individual RED/GREEN cycles; only scripts or affected Core/MCP/Viewer suites ran until the single final clean-state gate. Typecheck and build were both retained in the final gate because the release changed TypeScript project output and Vite path semantics. The sole repeated package generation was required for deterministic artifact evidence.

Known residual risks: Linux CI is configured but was not executed on GitHub in this local-only task; Windows has no end-to-end smoke; Node 22 still prints its standard experimental `node:sqlite` warning; npm audit reflects the registry state at execution time. The repository remains unpushed and unpublished, and any public release still requires separate human approval.
