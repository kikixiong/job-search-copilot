import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import test from "node:test";

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

test("license gate rejects unknown and strong-copyleft production dependencies", async () => {
  const { incompatibleLicenses } = await releaseModule();
  assert.equal(typeof incompatibleLicenses, "function", "license gate is not implemented");
  assert.deepEqual(incompatibleLicenses([
    { name: "allowed", version: "1.0.0", license: "MIT" },
    { name: "unknown", version: "1.0.0", license: "NOASSERTION" },
    { name: "copyleft", version: "2.0.0", license: "AGPL-3.0-only" }
  ]).map(({ name }) => name), ["copyleft", "unknown"]);
});
