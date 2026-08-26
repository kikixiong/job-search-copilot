import assert from "node:assert/strict";
import test from "node:test";

async function scanner() {
  try {
    return await import("../scan-sensitive.mjs");
  } catch {
    return {};
  }
}

test("rejects credentials, private keys, personal home paths, contact data, and application binaries", async () => {
  const { scanEntries } = await scanner();
  assert.equal(typeof scanEntries, "function", "tracked-file scanner is not implemented");
  const findings = scanEntries([
    { path: "notes.txt", content: "api_key=sk-live-abcdefghijklmnopqrstuvwxyz123456" },
    { path: "key.pem", content: "-----BEGIN PRIVATE KEY-----\nsynthetic\n-----END PRIVATE KEY-----" },
    { path: "profile.txt", content: "resume=/Users/example/Jobs/resume.txt" },
    { path: "contact.txt", content: "candidate@example.com +1 415 555 2671" },
    { path: "applications/candidate-resume.pdf", content: Buffer.from("%PDF synthetic") }
  ], { allowTestFixtures: true });

  assert.deepEqual(new Set(findings.map((finding) => finding.rule)), new Set([
    "credential",
    "private-key",
    "personal-home-path",
    "contact-data",
    "application-document",
    "application-artifact"
  ]));
});

test("allows public metadata and intentional synthetic .test fixtures only", async () => {
  const { scanEntries } = await scanner();
  assert.equal(typeof scanEntries, "function", "tracked-file scanner is not implemented");
  const findings = scanEntries([
    { path: "package.json", content: "https://github.com/kikixiong/job-search-copilot" },
    { path: "packages/core/test/privacy.test.ts", content: "const token = 'synthetic-secret'; const email = 'candidate@example.test';" },
    { path: "fixtures/jobs/sample.json", content: "{\"fixture\":true,\"source\":\"synthetic\"}" },
    { path: "packages/viewer/src/session.ts", content: "const cookie = request.headers.cookie; const token = randomBytes(32).toString('hex');" },
    { path: "package-lock.json", content: "sha512-AbCd012345678901234567890123456789==" }
  ], { allowTestFixtures: true });

  assert.deepEqual(findings, []);
});

test("does not exempt a .test file that lacks an explicit synthetic marker", async () => {
  const { scanEntries } = await scanner();
  const findings = scanEntries([
    { path: "packages/core/test/leaked.test.ts", content: "const leaked = 'sk-live-abcdefghijklmnopqrstuvwxyz123456';" }
  ], { allowTestFixtures: true });

  assert.deepEqual(findings.map(({ rule }) => rule), ["credential"]);
});

test("rejects Windows and root account home paths", async () => {
  const { scanEntries } = await scanner();
  const findings = scanEntries([
    { path: "windows.txt", content: "C:\\Users\\candidate\\Applications\\resume.txt" },
    { path: "linux.txt", content: "/root/private/resume.txt" }
  ]);

  assert.deepEqual(findings.map(({ rule }) => rule), ["personal-home-path", "personal-home-path"]);
});

test("rejects named text resume artifacts unless they are intentional synthetic .test fixtures", async () => {
  const { scanEntries } = await scanner();
  const findings = scanEntries([
    { path: "applications/candidate-resume.md", content: "Experience without contact details" },
    { path: "fixtures/sample-resume.json", content: "{\"source\":\"synthetic\"}" },
    { path: "packages/core/test/sample-resume.test.txt", content: "synthetic resume fixture" }
  ]);

  assert.deepEqual(findings.map(({ rule }) => rule), ["application-artifact", "application-artifact"]);
});
