import assert from "node:assert/strict";
import test from "node:test";
import { staticAssetPaths, syntheticResumeFixtures } from "../smoke-release.mjs";

test("release smoke discovers every local script and stylesheet asset", () => {
  assert.deepEqual(staticAssetPaths('<link rel="stylesheet" href="./assets/app.css"><script src="./assets/app.js"></script><img src="data:image/png;base64,x">'), [
    "./assets/app.css",
    "./assets/app.js"
  ]);
});

test("release smoke supplies every supported resume format", async () => {
  assert.equal(typeof syntheticResumeFixtures, "function", "isolated smoke resume fixtures are not implemented");
  const fixtures = await syntheticResumeFixtures();
  assert.deepEqual(fixtures.map(({ name }) => name), ["synthetic-resume.pdf", "synthetic-resume.docx", "synthetic-resume.txt", "synthetic-resume.md"]);
  assert.ok(fixtures.every(({ contents, expected }) => Buffer.isBuffer(contents) && contents.length > 0 && expected.length > 0));
  assert.match(fixtures[0].contents.toString("utf8", 0, 8), /^%PDF-/);
  assert.equal(fixtures[1].contents.subarray(0, 2).toString("ascii"), "PK");
});
