import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const forbiddenDocument = /\.(?:docx?|pdf|rtf|odt)$/i;
const namedTextApplicationArtifact = /(?:^|\/)[^/]*(?:resume|résumé|curriculum[-_ ]?vitae|cover[-_ ]?letter|contacts?)[^/]*\.(?:txt|md|markdown|csv|json|html?|ya?ml)$/i;
const intentionalTestFixture = /(?:^|\/)(?:test|tests)\/.*\.test\.[^/]+$/i;
const privateKey = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/;
const rootHome = ["ro", "ot"].join("");
const personalUnixHome = new RegExp(`(?:^|[^\\w])(?:\\/Users\\/[^/\\s]+|\\/home\\/[^/\\s]+|\\/${rootHome})(?:\\/|\\b)`);
const personalWindowsHome = /(?:^|[^\w])[A-Z]:\\Users\\[^\\\s]+(?:\\|$)/i;
const likelyCredential = /(?:["']?(?:api[_-]?key|access[_-]?token|auth(?:orization)?|cookie|password|secret|session[_-]?token)["']?\s*[:=]\s*["'][^"'\s]{12,}["']|^\s*(?:api[_-]?key|access[_-]?token|authorization|cookie|password|secret|session[_-]?token)\s*=\s*[A-Za-z0-9_./+=-]{12,}\s*$|\bBearer\s+[A-Za-z0-9._~+/=-]{16,}|\b(?:sk-(?:live|proj)-|gh[pousr]_)[A-Za-z0-9_-]{16,})/im;
const contactData = /(?:\b[A-Z0-9._%+-]+@(?!example\.test\b)[A-Z0-9.-]+\.[A-Z]{2,}\b|\+\d{1,3}[\s().-]+\d{2,4}[\s().-]+\d{2,4}[\s().-]+\d{3,4}|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b)/gi;
const syntheticCredentialValue = /(["'])synthetic-(?:secret|token|api-key|cookie|credential)\1/gi;

function textOf(content) {
  return Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
}

export function scanEntries(entries, { allowTestFixtures = true } = {}) {
  const findings = [];
  for (const entry of entries) {
    const path = entry.path.replaceAll("\\", "/");
    const content = textOf(entry.content);
    const isTestFixture = allowTestFixtures && intentionalTestFixture.test(path);
    const isIntentionalTest = isTestFixture && /synthetic/i.test(content);
    const credentialContent = isTestFixture ? content.replace(syntheticCredentialValue, "''") : content;
    if (forbiddenDocument.test(path) && !isIntentionalTest) {
      findings.push({ path, rule: "application-document", message: "禁止提交二进制申请材料。" });
    }
    if (namedTextApplicationArtifact.test(path) && !isIntentionalTest) {
      findings.push({ path, rule: "application-artifact", message: "禁止提交非测试用的简历或联系资料。" });
    }
    if (privateKey.test(content)) findings.push({ path, rule: "private-key", message: "检测到私钥块。" });
    if (personalUnixHome.test(content) || personalWindowsHome.test(content)) findings.push({ path, rule: "personal-home-path", message: "检测到个人主目录绝对路径。" });
    if (likelyCredential.test(credentialContent)) findings.push({ path, rule: "credential", message: "检测到疑似 cookie、token 或 API key。" });
    if ([...content.matchAll(contactData)].some((match) => !/\b555\b/.test(match[0]))) {
      findings.push({ path, rule: "contact-data", message: "检测到非合成联系方式。" });
    }
  }
  return findings;
}

export async function scanTrackedFiles(root = process.cwd()) {
  const output = execFileSync("git", ["ls-files", "-z"], { cwd: root });
  const paths = output.toString("utf8").split("\0").filter(Boolean);
  const entries = await Promise.all(paths.map(async (path) => ({ path, content: await readFile(resolve(root, path)) })));
  return scanEntries(entries);
}

async function main() {
  const findings = await scanTrackedFiles();
  if (findings.length === 0) {
    console.log("Sensitive-data scan passed for tracked files.");
    return;
  }
  for (const finding of findings) console.error(`${finding.path}: ${finding.rule}: ${finding.message}`);
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Sensitive-data scan failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
