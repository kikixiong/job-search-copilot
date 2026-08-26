import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function packager() {
  try { return await import("../build-release.mjs"); } catch { return {}; }
}

test("release plan contains the complete installable plugin contract", async () => {
  const { releaseFilePlan, packagedMcpManifest } = await packager();
  assert.equal(typeof releaseFilePlan, "function", "release packager is not implemented");
  const paths = releaseFilePlan().map(({ destination }) => destination);
  for (const required of [
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "README.md",
    "LICENSE",
    "PRIVACY.md",
    "SECURITY.md",
    "CONTRIBUTING.md",
    "NOTICE",
    "docs/ARCHITECTURE.md",
    "docs/SOURCE_POLICY.md",
    "docs/RELEASING.md",
    "skills",
    "references"
  ]) assert.ok(paths.includes(required), required);
  assert.deepEqual(packagedMcpManifest(), {
    mcpServers: {
      "job-search-copilot": { command: "node", args: ["dist/mcp/index.js"], cwd: "." }
    }
  });
});

test("release source enumeration includes tracked skill files and excludes untracked neighbors", async () => {
  const { trackedFilesBeneath } = await packager();
  assert.equal(typeof trackedFilesBeneath, "function", "tracked release source enumeration is not implemented");
  const root = await mkdtemp(join(tmpdir(), "job-search-tracked-release-"));
  try {
    await mkdir(join(root, "skills/example"), { recursive: true });
    await mkdir(join(root, "references"));
    await writeFile(join(root, "skills/example/SKILL.md"), "tracked\n");
    await writeFile(join(root, "skills/example/private-note.txt"), "untracked\n");
    await writeFile(join(root, "references/schema.md"), "tracked\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "skills/example/SKILL.md", "references/schema.md"], { cwd: root });

    assert.deepEqual(await trackedFilesBeneath(root, ["skills", "references"]), [
      "references/schema.md",
      "skills/example/SKILL.md"
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release archive validation rejects entries outside tracked sources and generated outputs", async () => {
  const { validateReleaseEntries } = await packager();
  assert.equal(typeof validateReleaseEntries, "function", "archive allowlist validation is not implemented");
  const planned = ["skills/example/SKILL.md", "README.md"];
  assert.doesNotThrow(() => validateReleaseEntries([
    "skills/example/SKILL.md",
    "README.md",
    ".mcp.json",
    "dist/mcp/index.js",
    "dist/static/index.html",
    "SBOM.cdx.json",
    "THIRD_PARTY_LICENSES.md"
  ], planned));
  assert.throws(() => validateReleaseEntries([...planned, "skills/example/private-note.txt"], planned), /not in the tracked release plan/i);
});
