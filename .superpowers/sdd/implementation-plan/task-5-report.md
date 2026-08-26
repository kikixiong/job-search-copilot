# Task 5 report — open-source release gate and supply-chain closure

## Outcome

Task 5 now delivers a Chinese-first, local-only release pipeline for Job Search Copilot `0.1.0`, followed by closure of the independent supply-chain review against `bb4d0f7`. The ignored `release/` directory contains a self-contained plugin and deterministic `.tgz` that require Node `>=22.13.0` but no `npm install`. No remote, push, npm publish, GitHub repository, marketplace install, personal plugin install, or live job-board automation was performed.

This report remains tracked because the binding Task 5 brief explicitly requires it. The independent review file and other review scratch files remain ignored and were not added to the release or commit.

## Review findings closed

### C-1 — self-contained PDF runtime and isolated smoke

- Replaced PDF.js 6 plus its `@napi-rs/canvas`/native-runtime dependency with `pdf2json@4.0.3`, a dependency-free pure JavaScript text-PDF parser. The release no longer copies PDF.js worker/fonts/CMaps/WASM and contains no `@napi-rs/canvas`, native binding, or external `node_modules` tree.
- `release:smoke` now extracts the final `.tgz` to a system `mkdtemp` directory outside the checkout, asserts that no ancestor contains `node_modules`, gives the child no `NODE_PATH`, starts the extracted `.mcp.json` from the installed plugin root, and safely removes the temporary directory in `finally`.
- The extracted-copy smoke initializes stdio MCP, lists exactly 12 tools, imports a synthetic text PDF, exchanges the one-use Viewer token, proves unauthenticated snapshot 401/authenticated snapshot 200, verifies CSP, and fetches both relative static assets.

### I-1/I-2 — tracked inputs and sensitive fixtures

- Release source staging now uses exact fixed tracked files plus `git ls-files -- skills references`; files are copied individually. Before archive generation, every entry must be a tracked plan destination or an explicitly allowed generated output. Controlled temporary-git tests prove an untracked skill neighbor is excluded and a plan-extra archive entry is rejected.
- The sensitive scanner no longer skips an entire `.test` file merely because it contains `synthetic`. Private keys, personal-home paths, credentials and contact data are always checked. Only an exact single synthetic credential placeholder in an eligible `.test` path is neutralized; `example.test` and 555 values remain the narrow obvious-fake contact forms.
- Existing Core/MCP/Viewer security fixtures now assemble sensitive test values from fragments at runtime so the scanner can inspect the test source without weakening production rules.

### I-3/I-4 — valid SBOM, compatibility and attribution

- CycloneDX 1.6 encodes a single standard SPDX license as `license.id`, SPDX OR/AND/WITH expressions as `expression`, and a non-SPDX legacy name as `license.name`.
- `validate:sbom` uses the locally installed official `@cyclonedx/cyclonedx-library` schemas with AJV; CI performs this validation after package generation and does not download a schema dynamically.
- The compatibility gate uses `spdx-expression-parse` and a documented static Apache-bundle policy. `OR` accepts a compatible selectable branch, `AND` requires every branch, and `WITH` requires an explicit allowed pair. GPL-only, LGPL-only, EPL, AGPL, SSPL, unknown and unlicensed expressions fail; `(MIT OR GPL-3.0-or-later)`, `(MIT AND Zlib)`, and `Apache-2.0 WITH LLVM-exception` pass.
- `THIRD_PARTY_LICENSES.md` now contains per-component metadata attribution plus complete installed LICENSE/NOTICE/COPYING/copyright material for every production inventory component. If upstream omits a license file, its README license section or SPDX reference text is included. Mammoth's BSD-2-Clause copyright, redistribution conditions and disclaimer are explicitly covered. esbuild uses `legalComments: "eof"` instead of stripping recognized legal comments.

### I-5 — runtime floor

Root engines, Chinese README, releasing/security documentation and Linux CI now consistently require Node `>=22.13.0`; CI pins the actual minimum `22.13.0`. This is the first Node 22 release where `node:sqlite` no longer needs an experimental flag.

## TDD evidence

Observed behavior-first RED → GREEN cycles for the review closure:

1. The first final-archive isolated smoke initialized and listed 12 tools but PDF import RED with `DOMMatrix is not defined`; the pure JavaScript parser made the same extracted-copy path GREEN.
2. Tracked-source and archive-plan tests RED because their packager APIs did not exist; GREEN excludes an untracked skill file and rejects an unexpected archive entry.
3. A `.test` fixture containing a synthetic marker plus a real-looking secret/private key/home path/contact returned no findings; GREEN reports all four. A second RED showed a secret hidden behind a `synthetic-secret-...` prefix; GREEN allows only the exact placeholder.
4. CycloneDX expression tests RED because OR/AND strings were placed in `license.id`; GREEN uses `expression`, and the official CycloneDX validator accepts the result.
5. GPL-only/LGPL-only/EPL probes RED because the old gate accepted them; the SPDX AST policy rejects them while preserving tested permissive dual/conjunctive cases.
6. The Mammoth notice regression RED because no notice collector existed; GREEN reproduces its copyright, conditions and disclaimer and expands the same collection to the full inventory.

Focused development evidence before the final gate:

- Core PDF format test: 1/1 after replacing the parser.
- Release layout/tracked/archive tests: 3/3.
- Release/SBOM/license/notice tests: 6/6 across the release and official-schema files.
- Sensitive scanner tests: 7/7.
- Modified Core/MCP/Viewer security suites: 44/44.
- Isolated final-archive smoke: exact 12 tools, bundled PDF import, Viewer auth and 2 static assets.

## Clean install and final gate

The first final `npm ci` encountered iCloud dataless duplicate entries in two ignored dependency directories. Read-only inspection identified `node_modules/yallist` and `node_modules/has-symbols`; each exact ignored directory was moved to a separate `mktemp` quarantine and the quarantine was removed by a bounded trap. No tracked or user data was removed. The resulting single successful clean install added 335 packages, audited 339, and found 0 vulnerabilities.

Final evidence after that install:

- Official plugin validator: passed.
- Official skill quick validators: 5/5 passed.
- Local plugin/config/fixture/skill validation: passed (2 synthetic JSON fixtures, 5 skills and their references).
- Non-mutating `npm run lint`: passed.
- `npm test`: 73/73 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; Viewer output HTML 0.45 kB, CSS 10.37 kB, JS 210.24 kB (66.79 kB gzip).
- `npm run audit:prod`: 0 vulnerabilities.
- `npm run scan:sensitive`: passed for tracked files.
- Production license policy: 121 unique components, 0 incompatible/unknown results.
- Official CycloneDX 1.6 schema validation: passed; SBOM contains the same 121 components and valid expression choices for jszip/pako.
- Final `.tgz`: 876,880 bytes; its archive contains no `node_modules`, PDF.js assets or native Canvas binding.
- Final isolated `.tgz` smoke: passed from outside the checkout with no ancestor `node_modules` and no `NODE_PATH`.

## Determinism and artifact integrity

Because dependency, source and generator inputs changed during review closure, the final package was generated twice exactly once from unchanged inputs. SHA-256 values of the `.tgz`, SBOM, complete license report, NOTICE and generated `SHA256SUMS` matched between the two runs. Only the second run remains as the ignored final release.

```text
ef74aaac9d1991f187969267a6e67b498df1aacf46e7275d80aa4cfa07483e34  job-search-copilot-0.1.0.tgz
80b817afb4042608105e3da2d5e3faac0ad515bec4a7248ef479235c667ecd47  job-search-copilot-0.1.0.cdx.json
643ba64205661f252d76bebfba8d3e0fc198a824865f916c89b41ee9f67fc697  job-search-copilot-0.1.0-licenses.md
b4b6a3682203664593a058a289ca14837ee73ea9df946b503d9d5544ce9dc0c9  NOTICE
0736ab043c18f1ce286574c2de1216917b4868a60e4553f83b020fdb61fceff4  SHA256SUMS file itself
```

Running `shasum -a 256 -c SHA256SUMS` from `release/` passed for all four listed final artifacts. No ordinary source, test, style or documentation file was hashed.

## Review, skipped repetition and residual risk

No subagent or independent implementation reviewer was started because the task explicitly prohibited subagents; the controller owns the independent re-review. During development only affected tests ran. After the successful clean install, lint/full tests/typecheck/build/audit/scanner ran once on the final implementation state, followed by the one required double-generation comparison and one schema/hash pass on the retained artifact. The isolated smoke was rerun once after its ancestor check was tightened to include the filesystem root; this did not change package inputs or regenerate artifacts. Unchanged-input builds, full suites and hash comparisons were not repeated.

Known residual risks: Linux CI is configured at Node 22.13.0 but has not been executed on GitHub in this local-only task; Windows remains path-compatible without an end-to-end release smoke; Node 22.13.0 may still print the standard experimental `node:sqlite` warning; npm audit represents registry state at execution time. The repository remains unpushed and unpublished, and public release still requires separate human approval.
