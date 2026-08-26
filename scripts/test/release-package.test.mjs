import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  const generated = ["dist/static/index.html"];
  assert.doesNotThrow(() => validateReleaseEntries([
    "skills/example/SKILL.md",
    "README.md",
    ".mcp.json",
    "dist/mcp/index.js",
    "dist/static/index.html",
    "SBOM.cdx.json",
    "THIRD_PARTY_LICENSES.md"
  ], planned, generated));
  assert.throws(() => validateReleaseEntries([...planned, "skills/example/private-note.txt"], planned, generated), /not in the tracked release plan/i);
  assert.throws(() => validateReleaseEntries([...planned, ...generated, "dist/static/private-note.txt"], planned, generated), /not in the tracked release plan/i);
});

test("release Viewer build ignores an untracked public sentinel and reports only emitted assets", async () => {
  const { buildViewerAssets } = await packager();
  assert.equal(typeof buildViewerAssets, "function", "release Viewer asset builder is not implemented");
  const root = await mkdtemp(join(tmpdir(), "job-search-viewer-release-"));
  const viewerRoot = join(root, "packages/viewer");
  const output = join(root, "stage/dist/static");
  try {
    await mkdir(join(viewerRoot, "src"), { recursive: true });
    await mkdir(join(viewerRoot, "public"));
    await writeFile(join(viewerRoot, "index.html"), '<script type="module" src="/src/main.js"></script>\n');
    await writeFile(join(viewerRoot, "src/main.js"), 'document.body.textContent = "tracked-viewer-asset";\n');
    await writeFile(join(viewerRoot, "public/private-note.txt"), "private-release-sentinel\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "packages/viewer/index.html", "packages/viewer/src/main.js"], { cwd: root });

    const emitted = await buildViewerAssets({ root: viewerRoot, outDir: output });
    assert.ok(emitted.includes("index.html"));
    assert.ok(emitted.some((path) => path.startsWith("assets/") && path.endsWith(".js")));
    assert.match(await readFile(join(output, emitted.find((path) => path.endsWith(".js"))), "utf8"), /tracked-viewer-asset/);
    await assert.rejects(readFile(join(output, "private-note.txt")), /ENOENT/);
    assert.equal(emitted.includes("private-note.txt"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release Viewer provenance rejects an untracked transitive module", async () => {
  const { buildViewerAssets } = await packager();
  const root = await mkdtemp(join(tmpdir(), "job-search-viewer-provenance-"));
  const viewerRoot = join(root, "packages/viewer");
  const output = join(root, "stage/dist/static");
  try {
    await mkdir(join(viewerRoot, "src"), { recursive: true });
    await writeFile(join(viewerRoot, "index.html"), '<script type="module" src="/src/main.js"></script>\n');
    await writeFile(join(viewerRoot, "src/main.js"), 'import { privateValue } from "./private.js"; document.body.textContent = privateValue;\n');
    await writeFile(join(viewerRoot, "src/private.js"), 'export const privateValue = "untracked-transitive";\n');
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "packages/viewer/index.html", "packages/viewer/src/main.js"], { cwd: root });

    await assert.rejects(
      buildViewerAssets({ root: viewerRoot, outDir: output }),
      /untracked.*private\.js|private\.js.*untracked|provenance/i
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release input provenance allows exact virtual and dependency IDs but rejects untracked repository files", async () => {
  const { validateBuildInputProvenance } = await packager();
  assert.equal(typeof validateBuildInputProvenance, "function", "build input provenance gate is not implemented");
  const root = await mkdtemp(join(tmpdir(), "job-search-build-provenance-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "node_modules/example"), { recursive: true });
    await writeFile(join(root, "src/entry.js"), "export {};\n");
    await writeFile(join(root, "src/private.js"), "export {};\n");
    await writeFile(join(root, "node_modules/example/index.js"), "export {};\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["add", "src/entry.js"], { cwd: root });

    await assert.doesNotReject(validateBuildInputProvenance({
      repositoryRoot: root,
      inputIds: [join(root, "src/entry.js"), join(root, "node_modules/example/index.js"), "\0vite/module", "virtual:generated"]
    }));
    await assert.rejects(validateBuildInputProvenance({
      repositoryRoot: root,
      inputIds: [join(root, "src/entry.js"), join(root, "src/private.js")]
    }), /untracked.*private\.js|private\.js.*untracked/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
