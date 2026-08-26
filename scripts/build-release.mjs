import { builtinModules } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";
import react from "@vitejs/plugin-react";
import { build as viteBuild } from "vite";

import { createCycloneDx, createDeterministicTgz, createThirdPartyNotices, incompatibleLicenses, isPathInside, productionPackages } from "./release-lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.1.0";
const artifactBase = `job-search-copilot-${version}`;
const fixedReleaseSources = [
  ".codex-plugin/plugin.json",
  "README.md",
  "LICENSE",
  "PRIVACY.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "NOTICE",
  "docs/ARCHITECTURE.md",
  "docs/SOURCE_POLICY.md",
  "docs/RELEASING.md"
];

export function releaseFilePlan() {
  return [
    ...fixedReleaseSources.map((source) => ({ source, destination: source })),
    { source: "skills", destination: "skills" },
    { source: "references", destination: "references" },
    { destination: ".mcp.json" }
  ];
}

export function packagedMcpManifest() {
  return { mcpServers: { "job-search-copilot": { command: "node", args: ["dist/mcp/index.js"], cwd: "." } } };
}

export async function trackedFilesBeneath(root, scopes) {
  const output = execFileSync("git", ["ls-files", "-z", "--", ...scopes], { cwd: root });
  return output.toString("utf8").split("\0").filter(Boolean).sort((left, right) => left.localeCompare(right, "en"));
}

function isVirtualBuildId(id) {
  return id.startsWith("\0") || id.startsWith("virtual:") || id.startsWith("/@id/") || id === "stdin" || (/^<[^<>]+>$/.test(id));
}

function cleanBuildId(id) {
  const withoutFsPrefix = id.startsWith("/@fs/") ? id.slice(4) : id;
  return withoutFsPrefix.replace(/[?#].*$/, "");
}

export async function validateBuildInputProvenance({ repositoryRoot: requestedRoot, inputIds }) {
  const root = await realpath(requestedRoot);
  const tracked = new Set((await trackedFilesBeneath(root, ["."])).map((item) => item.replaceAll("\\", "/")));
  const rejected = [];
  for (const inputId of [...new Set(inputIds)].sort((left, right) => left.localeCompare(right, "en"))) {
    if (!inputId || isVirtualBuildId(inputId)) continue;
    const cleaned = cleanBuildId(inputId);
    const absolute = resolve(root, cleaned);
    let canonical;
    try {
      canonical = await realpath(absolute);
    } catch {
      rejected.push(`${inputId} (missing build input)`);
      continue;
    }
    if (!isPathInside(root, canonical)) {
      rejected.push(`${inputId} (outside repository)`);
      continue;
    }
    const repositoryPath = relative(root, canonical).split(sep).join("/");
    if (repositoryPath.split("/").includes("node_modules")) continue;
    if (!tracked.has(repositoryPath)) rejected.push(`${repositoryPath} (untracked)`);
  }
  if (rejected.length) throw new Error(`Release build input provenance rejected: ${rejected.join(", ")}`);
}

function gitRepositoryRoot(directory) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf8" }).trim();
}

async function trackedReleasePlan() {
  const tracked = await trackedFilesBeneath(repositoryRoot, [...fixedReleaseSources, "skills", "references"]);
  const trackedSet = new Set(tracked);
  for (const source of fixedReleaseSources) {
    if (!trackedSet.has(source)) throw new Error(`Required release source is not tracked: ${source}`);
  }
  return tracked.map((source) => ({ source, destination: source }));
}

async function copyPlan(stage) {
  const plan = await trackedReleasePlan();
  for (const item of plan) {
    const destination = join(stage, item.destination);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repositoryRoot, item.source), destination);
  }
  await writeFile(join(stage, ".mcp.json"), JSON.stringify(packagedMcpManifest(), null, 2) + "\n");
  return plan.map(({ destination }) => destination);
}

export function validateReleaseEntries(entries, plannedSources, generatedOutputs = []) {
  const sources = new Set(plannedSources);
  const generated = new Set([
    ".mcp.json",
    "dist/mcp/index.js",
    "SBOM.cdx.json",
    "THIRD_PARTY_LICENSES.md",
    ...generatedOutputs
  ]);
  const unexpected = entries.filter((path) => !sources.has(path) && !generated.has(path));
  if (unexpected.length) throw new Error(`Release entry is not in the tracked release plan or generated-output allowlist: ${unexpected.join(", ")}`);
}

export async function buildViewerAssets({ root, outDir, plugins = [] }) {
  const result = await viteBuild({
    configFile: false,
    root,
    plugins,
    base: "./",
    publicDir: false,
    build: { outDir, emptyOutDir: true }
  });
  const builds = Array.isArray(result) ? result : [result];
  const moduleIds = builds.flatMap((build) => build.output.flatMap((output) => output.type === "chunk"
    ? [...Object.keys(output.modules), ...(output.facadeModuleId ? [output.facadeModuleId] : [])]
    : [...(output.originalFileNames ?? []), ...(output.originalFileName ? [output.originalFileName] : [])]));
  await validateBuildInputProvenance({
    repositoryRoot: gitRepositoryRoot(root),
    inputIds: [join(root, "index.html"), ...moduleIds]
  });
  return [...new Set(builds.flatMap((build) => build.output.map(({ fileName }) => fileName)))]
    .sort((left, right) => left.localeCompare(right, "en"));
}

async function filesBeneath(directory) {
  const entries = [];
  async function visit(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const path = join(current, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) {
        const details = await stat(path);
        entries.push({ path: relative(directory, path).replaceAll("\\", "/"), content: await readFile(path), mode: details.mode & 0o111 ? 0o755 : 0o644 });
      } else throw new Error(`Release input cannot contain links or special files: ${path}`);
    }
  }
  await visit(directory);
  return entries;
}

async function buildPlugin(stage) {
  const plannedSources = await copyPlan(stage);
  await mkdir(join(stage, "dist/mcp"), { recursive: true });
  const nodeBuiltins = [...new Set(builtinModules.flatMap((name) => name.startsWith("node:") ? [name] : [name, `node:${name}`]))];
  const mcpBuild = await esbuild({
    absWorkingDir: repositoryRoot,
    entryPoints: [join(repositoryRoot, "packages/mcp/src/index.ts")],
    outfile: join(stage, "dist/mcp/index.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    packages: "bundle",
    external: nodeBuiltins,
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    sourcemap: false,
    legalComments: "eof",
    charset: "utf8",
    logLevel: "warning",
    metafile: true
  });
  await validateBuildInputProvenance({ repositoryRoot, inputIds: Object.keys(mcpBuild.metafile.inputs) });
  const staticOutputs = await buildViewerAssets({
    root: join(repositoryRoot, "packages/viewer"),
    outDir: join(stage, "dist/static"),
    plugins: [react()]
  });
  const lock = JSON.parse(await readFile(join(repositoryRoot, "package-lock.json"), "utf8"));
  const packages = productionPackages(lock);
  const incompatible = incompatibleLicenses(packages);
  if (incompatible.length) throw new Error(`Incompatible or unknown production licenses: ${incompatible.map(({ name, license }) => `${name} (${license})`).join(", ")}`);
  const sbom = JSON.stringify(createCycloneDx(lock), null, 2) + "\n";
  const licenseReport = await createThirdPartyNotices(repositoryRoot, packages);
  await writeFile(join(stage, "SBOM.cdx.json"), sbom);
  await writeFile(join(stage, "THIRD_PARTY_LICENSES.md"), licenseReport);
  const archiveEntries = await filesBeneath(stage);
  validateReleaseEntries(
    archiveEntries.map(({ path }) => path),
    plannedSources,
    staticOutputs.map((path) => `dist/static/${path}`)
  );
  return { sbom, licenseReport, archiveEntries };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function writeArtifacts(stage, generated) {
  const releaseDirectory = join(repositoryRoot, "release");
  const finalPlugin = join(releaseDirectory, "job-search-copilot");
  await mkdir(releaseDirectory, { recursive: true });
  if (!isPathInside(releaseDirectory, finalPlugin)) throw new Error("Refusing to replace a release path outside release/.");
  await rm(finalPlugin, { recursive: true, force: true });
  await rename(stage, finalPlugin);
  const archive = createDeterministicTgz(generated.archiveEntries, "job-search-copilot");
  const notice = await readFile(join(repositoryRoot, "NOTICE"));
  const artifacts = new Map([
    [`${artifactBase}.tgz`, archive],
    [`${artifactBase}.cdx.json`, Buffer.from(generated.sbom)],
    [`${artifactBase}-licenses.md`, Buffer.from(generated.licenseReport)],
    ["NOTICE", notice]
  ]);
  for (const [name, content] of artifacts) await writeFile(join(releaseDirectory, name), content);
  const sums = [...artifacts].map(([name, content]) => `${sha256(content)}  ${name}`).join("\n") + "\n";
  await writeFile(join(releaseDirectory, "SHA256SUMS"), sums);
  console.log(`Release package written to ${relative(repositoryRoot, finalPlugin)} (${archive.length} bytes).`);
}

export async function buildRelease() {
  const temp = await mkdtemp(join(tmpdir(), "job-search-release-"));
  const stage = join(temp, "job-search-copilot");
  await mkdir(stage);
  const generated = await buildPlugin(stage);
  await writeArtifacts(stage, generated);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildRelease().catch((error) => {
    console.error(`Release build failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
