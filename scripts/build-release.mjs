import { builtinModules } from "node:module";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

import { createCycloneDx, createDeterministicTgz, incompatibleLicenses, productionPackages } from "./release-lib.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.1.0";
const artifactBase = `job-search-copilot-${version}`;

export function releaseFilePlan() {
  return [
    { source: ".codex-plugin/plugin.json", destination: ".codex-plugin/plugin.json" },
    { source: "README.md", destination: "README.md" },
    { source: "LICENSE", destination: "LICENSE" },
    { source: "PRIVACY.md", destination: "PRIVACY.md" },
    { source: "SECURITY.md", destination: "SECURITY.md" },
    { source: "CONTRIBUTING.md", destination: "CONTRIBUTING.md" },
    { source: "NOTICE", destination: "NOTICE" },
    { source: "docs/ARCHITECTURE.md", destination: "docs/ARCHITECTURE.md" },
    { source: "docs/SOURCE_POLICY.md", destination: "docs/SOURCE_POLICY.md" },
    { source: "docs/RELEASING.md", destination: "docs/RELEASING.md" },
    { source: "skills", destination: "skills" },
    { source: "references", destination: "references" },
    { destination: ".mcp.json" }
  ];
}

export function packagedMcpManifest() {
  return { mcpServers: { "job-search-copilot": { command: "node", args: ["dist/mcp/index.js"], cwd: "." } } };
}

async function copyPlan(stage) {
  for (const item of releaseFilePlan()) {
    if (!item.source) continue;
    const destination = join(stage, item.destination);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(repositoryRoot, item.source), destination, { recursive: true });
  }
  await writeFile(join(stage, ".mcp.json"), JSON.stringify(packagedMcpManifest(), null, 2) + "\n");
}

function licenseMarkdown(packages) {
  const lines = [
    "# Third-party production dependencies",
    "",
    "Generated from `package-lock.json` for the bundled `0.1.0` release.",
    "",
    "| Package | Version | License |",
    "| --- | --- | --- |",
    ...packages.map((item) => `| ${item.name.replaceAll("|", "\\|")} | ${item.version} | ${item.license} |`),
    ""
  ];
  return lines.join("\n");
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
  await copyPlan(stage);
  await mkdir(join(stage, "dist/mcp"), { recursive: true });
  const nodeBuiltins = [...new Set(builtinModules.flatMap((name) => name.startsWith("node:") ? [name] : [name, `node:${name}`]))];
  await esbuild({
    entryPoints: [join(repositoryRoot, "packages/mcp/src/index.ts")],
    outfile: join(stage, "dist/mcp/index.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    packages: "bundle",
    define: { __JOB_SEARCH_COPILOT_BUNDLED__: "true" },
    external: nodeBuiltins,
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    sourcemap: false,
    legalComments: "none",
    charset: "utf8",
    logLevel: "warning"
  });
  await cp(join(repositoryRoot, "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"), join(stage, "dist/mcp/pdf.worker.mjs"));
  for (const directory of ["standard_fonts", "cmaps", "wasm"]) {
    await cp(join(repositoryRoot, `node_modules/pdfjs-dist/${directory}`), join(stage, `dist/pdfjs/${directory}`), { recursive: true });
  }
  await viteBuild({
    configFile: join(repositoryRoot, "packages/viewer/vite.config.ts"),
    root: join(repositoryRoot, "packages/viewer"),
    build: { outDir: join(stage, "dist/static"), emptyOutDir: true }
  });
  const lock = JSON.parse(await readFile(join(repositoryRoot, "package-lock.json"), "utf8"));
  const packages = productionPackages(lock);
  const incompatible = incompatibleLicenses(packages);
  if (incompatible.length) throw new Error(`Incompatible or unknown production licenses: ${incompatible.map(({ name, license }) => `${name} (${license})`).join(", ")}`);
  const sbom = JSON.stringify(createCycloneDx(lock), null, 2) + "\n";
  const licenseReport = licenseMarkdown(packages);
  await writeFile(join(stage, "SBOM.cdx.json"), sbom);
  await writeFile(join(stage, "THIRD_PARTY_LICENSES.md"), licenseReport);
  return { sbom, licenseReport };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function writeArtifacts(stage, generated) {
  const releaseDirectory = join(repositoryRoot, "release");
  const finalPlugin = join(releaseDirectory, "job-search-copilot");
  await mkdir(releaseDirectory, { recursive: true });
  if (!finalPlugin.startsWith(`${releaseDirectory}/`)) throw new Error("Refusing to replace a release path outside release/.");
  await rm(finalPlugin, { recursive: true, force: true });
  await rename(stage, finalPlugin);
  const archive = createDeterministicTgz(await filesBeneath(finalPlugin), "job-search-copilot");
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
