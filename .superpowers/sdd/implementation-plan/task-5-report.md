# Task 5 report — open-source release gate and supply-chain closure

## Outcome

Task 5 delivers a Chinese-first, local-only release pipeline for Job Search Copilot `0.1.0`, including both independent supply-chain review closure rounds. The ignored `release/` directory contains a self-contained plugin and deterministic `.tgz` that require Node `>=22.13.0` but no `npm install`. No remote, push, npm publish, marketplace install, personal plugin install, or live job-board automation was performed.

This report remains tracked because the binding Task 5 brief explicitly requires it. Independent review scratch files remain ignored and were not added to the release or commit.

## Findings closed

### C-1 — self-contained PDF runtime and isolated smoke

- PDF import uses dependency-free pure-JavaScript `pdf2json@4.0.3`; the release contains no PDF.js worker/native Canvas runtime, `.node` binding, or external `node_modules` tree.
- `release:smoke` extracts the final `.tgz` to a system `mkdtemp` directory outside the checkout, rejects `node_modules` at every ancestor through the filesystem root, gives the child no `NODE_PATH`, starts packaged `.mcp.json` from the installed plugin root, and removes the temporary directory in `finally`.
- The extracted-copy smoke initializes stdio MCP, lists exactly 12 tools, imports a synthetic text PDF, exchanges the one-use Viewer token, proves unauthenticated 401/authenticated 200, verifies CSP, and fetches both relative static assets.

### I-1 — exact tracked and generated release inputs

- Source staging copies exact fixed tracked files plus `git ls-files -- skills references`; untracked skill/reference neighbors cannot enter the stage.
- Viewer builds set `publicDir: false` globally and again at the release boundary. A controlled temporary git repository proves an untracked `packages/viewer/public/private-note.txt` analogue is absent from the stage while a tracked imported module is emitted.
- Vite's actual Rollup output filenames form the exact static generated-output allowlist. `validateReleaseEntries` no longer accepts an arbitrary `dist/static/**` prefix, and a controlled extra static entry is rejected.

### I-2 — sensitive fixtures without a global contact bypass

- The scanner never skips a whole synthetic file. Private keys, personal-home paths, credentials and contacts remain independently checked.
- The global exception for contact matches containing a fake-number token was removed. Controlled non-test email and phone values containing that token now both produce `contact-data` findings.
- Existing Core and Viewer contact fixtures assemble their values from fragments at runtime, so tracked-file self-scan passes without weakening production rules. Only an exact synthetic credential placeholder in an eligible `.test` file and the reserved `example.test` domain receive narrow exceptions.

### I-3/I-4 — valid SBOM, compatibility and complete attribution

- CycloneDX 1.6 encodes single SPDX IDs as `license.id`, SPDX expressions as `expression`, and non-SPDX names as `license.name`. The locally locked official CycloneDX validator runs in CI without downloading schemas.
- The static Apache-bundle policy parses SPDX `OR`, `AND` and `WITH`: a compatible `OR` choice is accepted, every `AND` branch must be compatible, and `WITH` requires an explicit allowed pair. GPL-only, LGPL-only, EPL, AGPL, SSPL, unknown and unlicensed expressions fail closed.
- Every retained SBOM component has a generated notice section containing installed LICENSE/NOTICE/COPYING/copyright material or an allowed upstream fallback. Any fallback still containing template markers such as `<year>` or `<owner>` now fails packaging. The regression also checks concrete BSD copyright, conditions and disclaimer text from a current bundled component. esbuild retains recognized legal comments at EOF.

The exact `dingbat-to-unicode@1.0.1` artifact could not receive a truthful override. Primary-source review covered npm version `1.0.1` (integrity `sha512-98l0sW87ZT58pU4i61wa2OHwxbiYSbuxsCBozaVnYX2iCnr3bLM3fIes1/ej7h1YdOKuKt/MLs706TVnALA65w==`) and upstream tag `js-1.0.1`, commit `b27f259b49907f99b1b9097abba5a9668106b779`:

- npm metadata: https://registry.npmjs.org/dingbat-to-unicode/1.0.1
- exact upstream tag: https://github.com/mwilliamson/dingbat-to-unicode/tree/js-1.0.1
- exact tag tree: https://api.github.com/repos/mwilliamson/dingbat-to-unicode/git/trees/b27f259b49907f99b1b9097abba5a9668106b779?recursive=1
- exact package manifest: https://raw.githubusercontent.com/mwilliamson/dingbat-to-unicode/b27f259b49907f99b1b9097abba5a9668106b779/js/package.json

The matching npm package and tag contain a BSD declaration plus author metadata, but no LICENSE file or concrete copyright notice. Author metadata was not rewritten as a copyright claim. Following the review's explicit fallback, the Mammoth-to-dingbat dependency chain was removed. DOCX text extraction now directly uses MIT-licensed `jszip@3.10.1` and `@xmldom/xmldom@0.8.15`, reads the declared main document relationship, rejects unsafe relationship targets, parses WordprocessingML text/tabs/breaks/paragraphs/tables, and retains the existing DOCX import contract.

### I-5 — runtime floor

Root engines, Chinese README, release/security documentation and Linux CI consistently require Node `>=22.13.0`; CI pins `22.13.0`.

## TDD and focused evidence

Behavior-first RED → GREEN cycles added by the scoped re-review:

1. Archive validation initially accepted an arbitrary static private note and no release Viewer helper existed. GREEN disables Vite public copying, returns actual emitted files, and rejects the unplanned static entry.
2. Two non-test contact values containing the former fake-number token initially produced no contact findings. GREEN removes that global exception; tracked fixtures use runtime fragments and scanner self-scan passes.
3. A synthetic BSD package with no license material initially generated unresolved SPDX template placeholders. GREEN rejects the fallback with an actionable error.
4. Exact upstream research found no defensible dingbat copyright notice. Instead of inventing one, the dependency chain was removed; the existing real DOCX format test remained GREEN through clean install with only the two direct MIT parser dependencies.

Focused post-change evidence:

- Release package/sensitive/license regressions: 18/18.
- Core suite after the DOCX replacement: 25/25, including TXT/Markdown/PDF/DOCX import.
- Core typecheck: passed.
- Production license preflight: 109 components, every notice section present, 0 incompatible, 0 placeholders, Mammoth/dingbat absent.
- Tracked sensitive scanner: passed.

## Clean install and final gate

Because the dependency lock changed, one new clean `npm ci` installed 323 packages, audited 327, and found 0 vulnerabilities. It removed the former extraneous Mammoth/dingbat directories. The earlier review round's iCloud dataless quarantine workaround is documented in commit history; it did not recur in this scoped fix.

The first final lint attempt found one `preserve-caught-error` violation in the new DOCX archive error. The implementation attached the caught error as `cause`, then the affected file lint and Core suite passed. One final complete gate ran after that fix:

- Official plugin validator: passed.
- Official skill quick validators: 5/5 passed.
- Local config/fixture/skill validation: passed (2 synthetic JSON fixtures, 5 skills and references).
- Non-mutating lint: passed.
- Full tests: 76/76 passed.
- Typecheck: passed.
- Build: passed; Viewer HTML 0.45 kB, CSS 10.37 kB, JS 210.24 kB (66.79 kB gzip).
- Production audit: 0 vulnerabilities.
- Tracked sensitive scanner: passed.
- Production license policy/notices: 109 components, 0 incompatible, 0 placeholders, all notice sections present.
- Official CycloneDX 1.6 schema validation: passed; retained SBOM has 109 components.
- Final `.tgz`: 771,657 bytes and no private-note sentinel, `node_modules`, Mammoth/dingbat, or native binding.
- Final isolated retained-`.tgz` smoke: exactly 12 MCP tools, bundled PDF import, Viewer auth and 2 relative static assets.

## Determinism and artifact integrity

After all package inputs stopped changing, the release was generated twice exactly once. The five output hashes matched; only the second run remains as the ignored final release.

```text
b930a503413cdfd1b43377480799682d8d98c04d2035baec8ae438993bdfc4fa  job-search-copilot-0.1.0.tgz
c0d552bc67711add65a3d0de64a257311a0502d575c555cce88dbbd87f3105ad  job-search-copilot-0.1.0.cdx.json
0323c3c506cf5ddbca2dbf17d8c824b9ff23253b0554b87c365773e84a71eb4f  job-search-copilot-0.1.0-licenses.md
b4b6a3682203664593a058a289ca14837ee73ea9df946b503d9d5544ce9dc0c9  NOTICE
45da1935b785c4145fd1ad73ad31dcfeb70aa47f0c75fa295361a3ecacf8176a  SHA256SUMS file itself
```

`shasum -a 256 -c SHA256SUMS` passed for all four listed artifacts. Ordinary source, test and documentation files were not hashed.

## Review, skipped repetition and residual risk

No subagent or independent implementation reviewer was started because the task explicitly prohibited subagents; the controller owns the independent re-review. Official plugin/skill validation from the same final metadata state was reused after a DOCX-only `Error.cause` fix because that source edit cannot affect plugin metadata or skills. The affected file lint and Core suite were rerun, followed by one final lint/full-test/typecheck/build/audit/scanner gate. Package inputs were generated only for the required final double comparison, and schema/hash/smoke checks ran only on the retained second artifact.

Known residual risks: Linux CI is pinned to Node 22.13.0 but was not executed remotely in this local-only task; Windows remains path-compatible without an end-to-end release smoke; the direct DOCX extractor intentionally covers visible main-document WordprocessingML and does not extract headers, footers, footnotes or embedded non-text objects; Node may print the standard experimental `node:sqlite` warning; npm audit represents registry state at execution time. The repository remains unpushed and unpublished, and public release still requires separate human approval.

## Final-review closure addendum — input provenance, archive limits, pins, and retained artifact

The final repository review strengthens the release boundary further:

- The release build validates esbuild metafile inputs and actual Vite/Rollup module, facade, and original-file IDs. Every repository-local input must resolve to a git-tracked file; only exact virtual IDs and exact `node_modules` path components are exempt. Workspace Core and Viewer imports are bundled directly from tracked `src/index.ts` entry points, never untracked generated `dist`. Relative Vite IDs resolve from the Viewer build root while containment remains anchored to the repository. Controlled tests prove an untracked transitive Viewer import is rejected.
- Release containment uses a shared `path.relative` helper, with `path.win32` drive and sibling-prefix regressions.
- DOCX ZIP central-directory metadata is checked before expansion: entry count, per-entry uncompressed size, aggregate uncompressed size, and relationship size are bounded, then actual expanded byte lengths are checked again. A highly compressible oversized-entry regression is rejected before extraction.
- CI action references are full commit SHAs with reviewed `# v4` comments. Read-only official-tag verification confirmed `actions/checkout@v4` as `11d5960a326750d5838078e36cf38b85af677262` and `actions/setup-node@v4` as `49933ea5288caeca8642d1e84afbd3f7d6820020`; configuration validation rejects tags or malformed pins.
- The isolated retained-package smoke now imports PDF, DOCX, TXT, and Markdown in addition to proving exactly 12 MCP tools, Viewer authentication, and both static assets.

Two release attempts correctly failed before a successful artifact existed: first on untracked generated workspace `dist` inputs, then on a relative Vite `index.html` ID. Both causes were fixed without weakening the provenance gate and covered by focused tests. After inputs stabilized, exactly two successful generations were performed. All five hashes matched; the retained package is 779,786 bytes:

```text
929e9405f929358bc915ba8116035f586859eb9880032fb632067007b0cbea35  job-search-copilot-0.1.0.tgz
c0d552bc67711add65a3d0de64a257311a0502d575c555cce88dbbd87f3105ad  job-search-copilot-0.1.0.cdx.json
0323c3c506cf5ddbca2dbf17d8c824b9ff23253b0554b87c365773e84a71eb4f  job-search-copilot-0.1.0-licenses.md
b4b6a3682203664593a058a289ca14837ee73ea9df946b503d9d5544ce9dc0c9  NOTICE
b4e7ade18b42fca607ec7e936bb4b812598faa2c545ffb4dcd2fa3be8852d9b1  SHA256SUMS file itself
```

`shasum -a 256 -c SHA256SUMS` passed. The official CycloneDX library validated version 1.6 with 109 components; generated license material has 110 Markdown sections; package construction's compatibility and placeholder gates passed. The archive contains 31 entries under the single `job-search-copilot/` root and no `node_modules`, `.git`, private sentinel, Mammoth/dingbat, or native binding entry.

Fresh final evidence after the last release-script change: local validators plus `npm test` 97/97, lint, tracked sensitive scan, deterministic double package, SBOM validation, checksums, and isolated package smoke all passed. Existing TypeScript/build/audit evidence was reused because no TypeScript production source, Viewer input, dependency, or lockfile changed afterward. `npm ci` was intentionally skipped because this final-review change set did not modify dependencies or the lockfile.

Residual platform and format limits remain unchanged: no remote Linux CI or Windows end-to-end smoke was run; Windows path compatibility is unit-tested; DOCX extraction is limited to visible main-document WordprocessingML; Node 22 may print its experimental SQLite warning; audit evidence is point-in-time. No remote, push, publish, plugin install, or live application action was performed.
