import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, win32 } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function releaseModule() {
  try {
    return await import("../release-lib.mjs");
  } catch {
    return {};
  }
}

test("writes sorted deterministic tar metadata under one plugin root", async () => {
  const { createDeterministicTgz } = await releaseModule();
  assert.equal(typeof createDeterministicTgz, "function", "release archive builder is not implemented");
  const compressed = createDeterministicTgz([
    { path: "z.txt", content: Buffer.from("z") },
    { path: "a.txt", content: Buffer.from("a") }
  ], "job-search-copilot");
  const tar = gunzipSync(compressed);

  assert.equal(tar.subarray(0, 100).toString().replaceAll("\0", ""), "job-search-copilot/a.txt");
  assert.equal(tar.subarray(136, 148).toString().replaceAll("\0", "").trim(), "00000000000");
  assert.equal(tar.subarray(1024, 1124).toString().replaceAll("\0", ""), "job-search-copilot/z.txt");
});

test("release containment uses path-relative semantics for Windows paths", async () => {
  const { isPathInside } = await releaseModule();
  assert.equal(typeof isPathInside, "function", "release containment helper is not implemented");
  const root = String.raw`C:\repo\release`;
  assert.equal(isPathInside(root, String.raw`C:\repo\release\job-search-copilot`, win32), true);
  assert.equal(isPathInside(root, String.raw`C:\repo\release-escape\job-search-copilot`, win32), false);
  assert.equal(isPathInside(root, String.raw`C:\repo\outside`, win32), false);
  assert.equal(isPathInside(root, String.raw`D:\repo\release\job-search-copilot`, win32), false);
});

test("builds a CycloneDX production inventory without development packages", async () => {
  const { createCycloneDx } = await releaseModule();
  assert.equal(typeof createCycloneDx, "function", "SBOM builder is not implemented");
  const lock = {
    name: "job-search-copilot",
    version: "0.1.0",
    packages: {
      "": { name: "job-search-copilot", version: "0.1.0" },
      "node_modules/runtime": { version: "1.2.3", license: "MIT" },
      "node_modules/dev-only": { version: "4.5.6", dev: true, license: "ISC" }
    }
  };
  const bom = createCycloneDx(lock, new Map([
    ["runtime@1.2.3", { license: "MIT" }],
    ["dev-only@4.5.6", { license: "ISC" }]
  ]));

  assert.equal(bom.bomFormat, "CycloneDX");
  assert.equal(bom.specVersion, "1.6");
  assert.deepEqual(bom.components.map((component) => component.name), ["runtime"]);
  assert.equal(bom.components[0].purl, "pkg:npm/runtime@1.2.3");
});

test("encodes SPDX expressions and non-SPDX license names as CycloneDX 1.6 license choices", async () => {
  const { createCycloneDx } = await releaseModule();
  const lock = {
    name: "job-search-copilot",
    version: "0.1.0",
    packages: {
      "node_modules/single": { version: "1.0.0", license: "MIT" },
      "node_modules/choice": { version: "1.0.0", license: "(MIT OR GPL-3.0-or-later)" },
      "node_modules/combined": { version: "1.0.0", license: "(MIT AND Zlib)" },
      "node_modules/legacy": { version: "1.0.0", license: "BSD" }
    }
  };
  const components = Object.fromEntries(createCycloneDx(lock).components.map((component) => [component.name, component]));

  assert.deepEqual(components.single.licenses, [{ license: { id: "MIT" } }]);
  assert.deepEqual(components.choice.licenses, [{ expression: "(MIT OR GPL-3.0-or-later)" }]);
  assert.deepEqual(components.combined.licenses, [{ expression: "(MIT AND Zlib)" }]);
  assert.deepEqual(components.legacy.licenses, [{ license: { name: "BSD" } }]);
});

test("license gate parses SPDX conjunctions, choices, and exceptions for a static Apache bundle", async () => {
  const { incompatibleLicenses } = await releaseModule();
  assert.equal(typeof incompatibleLicenses, "function", "license gate is not implemented");
  assert.deepEqual(incompatibleLicenses([
    { name: "allowed", version: "1.0.0", license: "MIT" },
    { name: "dual", version: "1.0.0", license: "(MIT OR GPL-3.0-or-later)" },
    { name: "combined", version: "1.0.0", license: "(MIT AND Zlib)" },
    { name: "exception", version: "1.0.0", license: "Apache-2.0 WITH LLVM-exception" },
    { name: "unknown", version: "1.0.0", license: "NOASSERTION" },
    { name: "gpl", version: "2.0.0", license: "GPL-3.0-only" },
    { name: "lgpl", version: "2.0.0", license: "LGPL-3.0-only" },
    { name: "epl", version: "2.0.0", license: "EPL-2.0" }
  ]).map(({ name }) => name), ["epl", "gpl", "lgpl", "unknown"]);
});

test("third-party notices reproduce BSD copyright, conditions, and disclaimer", async () => {
  const { createThirdPartyNotices } = await releaseModule();
  assert.equal(typeof createThirdPartyNotices, "function", "third-party notice collection is not implemented");
  const notices = await createThirdPartyNotices(repositoryRoot, [{
    name: "json-schema-typed",
    version: "8.0.2",
    license: "BSD-2-Clause",
    lockPath: "node_modules/json-schema-typed"
  }]);

  assert.match(notices, /Original source code is copyright \(c\) 2019-2025 Remy Rylan/);
  assert.match(notices, /Redistributions in binary form must reproduce/);
  assert.match(notices, /THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"/);
});

test("third-party notice generation rejects unresolved license template placeholders", async () => {
  const { createThirdPartyNotices } = await releaseModule();
  const root = await mkdtemp(join(tmpdir(), "job-search-license-fallback-"));
  try {
    await mkdir(join(root, "node_modules/no-license"), { recursive: true });
    await writeFile(join(root, "node_modules/no-license/package.json"), JSON.stringify({
      name: "no-license",
      version: "1.0.0",
      author: "Synthetic Author",
      license: "BSD-2-Clause"
    }));
    await assert.rejects(createThirdPartyNotices(root, [{
      name: "no-license",
      version: "1.0.0",
      license: "BSD-2-Clause",
      lockPath: "node_modules/no-license"
    }]), /unresolved license template placeholder/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
