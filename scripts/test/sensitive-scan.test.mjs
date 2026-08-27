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
  const secret = ["sk", "-live-abcdefghijklmnopqrstuvwxyz123456"].join("");
  const privateKey = ["-----BEGIN PRI", "VATE KEY-----\nfixture\n-----END PRIVATE KEY-----"].join("");
  const homePath = ["/Us", "ers/candidate/Jobs/resume.txt"].join("");
  const email = ["candidate", "@company.invalid"].join("");
  const phone = ["+1 415", " 867 5309"].join("");
  const findings = scanEntries([
    { path: "notes.txt", content: `api_key=${secret}` },
    { path: "key.pem", content: privateKey },
    { path: "profile.txt", content: `resume=${homePath}` },
    { path: "contact.txt", content: `${email} ${phone}` },
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
  const secret = ["sk", "-live-abcdefghijklmnopqrstuvwxyz123456"].join("");
  const findings = scanEntries([
    { path: "packages/core/test/leaked.test.ts", content: `const leaked = '${secret}';` }
  ], { allowTestFixtures: true });

  assert.deepEqual(findings.map(({ rule }) => rule), ["credential"]);
});

test("rejects Windows and root account home paths", async () => {
  const { scanEntries } = await scanner();
  const findings = scanEntries([
    { path: "windows.txt", content: ["C:\\Us", "ers\\candidate\\Applications\\resume.txt"].join("") },
    { path: "linux.txt", content: ["/ro", "ot/private/resume.txt"].join("") }
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

test("synthetic marker does not exempt a real secret, private key, home path, or contact", async () => {
  const { scanEntries } = await scanner();
  const secret = ["sk", "-live-abcdefghijklmnopqrstuvwxyz123456"].join("");
  const privateKeyHeader = ["-----BEGIN PRI", "VATE KEY-----"].join("");
  const homePath = ["/ro", "ot/private/resume.txt"].join("");
  const email = ["candidate", "@company.invalid"].join("");
  const findings = scanEntries([{
    path: "packages/core/test/mixed.test.ts",
    content: ["// synthetic fixture", `api_key='${secret}'`, privateKeyHeader, homePath, email].join("\n")
  }]);

  assert.deepEqual(findings.map(({ rule }) => rule), [
    "private-key",
    "personal-home-path",
    "credential",
    "contact-data"
  ]);
});

test("synthetic credential exception accepts only an exact placeholder value", async () => {
  const { scanEntries } = await scanner();
  const secret = ["sk", "-live-abcdefghijklmnopqrstuvwxyz123456"].join("");
  const findings = scanEntries([{
    path: "packages/core/test/prefixed.test.ts",
    content: `// synthetic fixture\nconst token = 'synthetic-secret-${secret}';`
  }]);

  assert.deepEqual(findings.map(({ rule }) => rule), ["credential"]);
});

test("555 contact data is rejected outside synthetic fixtures", async () => {
  const { scanEntries } = await scanner();
  const email = ["candidate.555", "@company.invalid"].join("");
  const phone = ["+1 212 ", "555 6789"].join("");
  const findings = scanEntries([
    { path: "notes.txt", content: email },
    { path: "phone.txt", content: phone }
  ]);

  assert.deepEqual(findings.map(({ rule }) => rule), ["contact-data", "contact-data"]);
});
