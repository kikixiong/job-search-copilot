import assert from "node:assert/strict";
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
