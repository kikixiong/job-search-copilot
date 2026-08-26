import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import parseSpdx from "spdx-expression-parse";
import spdxLicenseList from "spdx-license-list/full.js";

const compatibleLicenseIds = new Set(["0BSD", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "CC0-1.0", "ISC", "MIT", "Zlib"]);
const compatibleLegacyNames = new Set(["BSD"]);
const compatibleExceptions = new Set(["Apache-2.0 WITH LLVM-exception"]);

function octal(value, width) {
  return value.toString(8).padStart(width - 1, "0") + "\0";
}

function writeText(header, offset, width, value) {
  header.write(value, offset, Math.min(width, Buffer.byteLength(value)), "utf8");
}

function tarHeader(path, size, mode) {
  if (Buffer.byteLength(path) > 100) throw new Error(`Tar path exceeds 100 bytes: ${path}`);
  const header = Buffer.alloc(512);
  writeText(header, 0, 100, path);
  writeText(header, 100, 8, octal(mode, 8));
  writeText(header, 108, 8, octal(0, 8));
  writeText(header, 116, 8, octal(0, 8));
  writeText(header, 124, 12, octal(size, 12));
  writeText(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeText(header, 257, 6, "ustar\0");
  writeText(header, 263, 2, "00");
  writeText(header, 265, 32, "root");
  writeText(header, 297, 32, "root");
  writeText(header, 148, 8, octal([...header].reduce((sum, byte) => sum + byte, 0), 8));
  return header;
}

export function createDeterministicTgz(entries, rootName) {
  const chunks = [];
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path, "en"))) {
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    const path = `${rootName}/${entry.path.replace(/^\/+/, "")}`;
    chunks.push(tarHeader(path, content.length, entry.mode ?? 0o644), content);
    const remainder = content.length % 512;
    if (remainder) chunks.push(Buffer.alloc(512 - remainder));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
}

function packageName(lockPath) {
  const parts = lockPath.split("/node_modules/");
  const tail = parts.length > 1 ? parts.at(-1) : lockPath.replace(/^node_modules\//, "");
  return tail || "";
}

function npmPurl(name, version) {
  const encoded = encodeURIComponent(name).replace("%2F", "/");
  return `pkg:npm/${encoded}@${version}`;
}

export function productionPackages(lock, metadata = new Map()) {
  const packages = Object.entries(lock.packages ?? {})
    .filter(([path, item]) => path.includes("node_modules/") && item?.version && item.dev !== true)
    .map(([path, item]) => {
      const name = packageName(path);
      const extra = metadata.get(`${name}@${item.version}`) ?? {};
      return { name, version: item.version, license: extra.license ?? item.license ?? "NOASSERTION", repository: extra.repository ?? null, integrity: item.integrity ?? null, lockPath: path };
    });
  return [...new Map(packages.map((item) => [`${item.name}@${item.version}`, item])).values()]
    .sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, "en"));
}

export function incompatibleLicenses(packages) {
  return packages
    .filter(({ license }) => !isCompatibleLicenseExpression(license))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function isCompatibleSpdxNode(node) {
  if (node.conjunction === "or") return isCompatibleSpdxNode(node.left) || isCompatibleSpdxNode(node.right);
  if (node.conjunction === "and") return isCompatibleSpdxNode(node.left) && isCompatibleSpdxNode(node.right);
  if (node.exception) return compatibleExceptions.has(`${node.license} WITH ${node.exception}`);
  return compatibleLicenseIds.has(node.license);
}

export function isCompatibleLicenseExpression(expression) {
  if (compatibleLegacyNames.has(expression)) return true;
  try {
    return isCompatibleSpdxNode(parseSpdx(expression));
  } catch {
    return false;
  }
}

function cycloneDxLicenseChoice(expression) {
  try {
    const parsed = parseSpdx(expression);
    if (!parsed.conjunction && !parsed.exception && spdxLicenseList[parsed.license]) {
      return { license: { id: parsed.license } };
    }
    return { expression };
  } catch {
    return { license: { name: expression } };
  }
}

export function createCycloneDx(lock, metadata = new Map()) {
  const components = productionPackages(lock, metadata).map((item) => ({
    type: "library",
    "bom-ref": npmPurl(item.name, item.version),
    name: item.name,
    version: item.version,
    licenses: [cycloneDxLicenseChoice(item.license)],
    purl: npmPurl(item.name, item.version)
  }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: { component: { type: "application", name: lock.name ?? "job-search-copilot", version: lock.version ?? "0.1.0" } },
    components
  };
}

function packageAuthor(author) {
  if (typeof author === "string") return author;
  if (!author || typeof author !== "object") return "Not supplied";
  return [author.name, author.url].filter(Boolean).join(" — ") || "Not supplied";
}

function packageRepository(repository) {
  if (typeof repository === "string") return repository;
  if (!repository || typeof repository !== "object") return "Not supplied";
  return repository.url ?? "Not supplied";
}

function licenseIds(node) {
  if (node.conjunction) return [...licenseIds(node.left), ...licenseIds(node.right)];
  return [node.license];
}

function fallbackLicenseText(expression) {
  let ids;
  try {
    ids = licenseIds(parseSpdx(expression));
  } catch {
    ids = expression === "BSD" ? ["BSD-2-Clause"] : [];
  }
  const texts = [...new Set(ids)].flatMap((id) => {
    const license = spdxLicenseList[id];
    return license ? [`SPDX reference text for ${id}\n\n${license.licenseText}`] : [];
  });
  return texts.join("\n\n");
}

function readmeLicenseSection(readme) {
  const match = readme.match(/^#{1,3}\s+licen[cs]e\s*$([\s\S]*)/im);
  return match && /(?:Permission is hereby granted|Redistribution and use|Licensed under)/i.test(match[1]) ? match[0].trim() : "";
}

export async function createThirdPartyNotices(repositoryRoot, packages) {
  const sections = [];
  for (const item of packages) {
    if (!item.lockPath?.includes("node_modules/")) throw new Error(`Missing lockfile path for ${item.name}@${item.version}.`);
    const packageDirectory = resolve(repositoryRoot, item.lockPath);
    const manifest = JSON.parse(await readFile(resolve(packageDirectory, "package.json"), "utf8"));
    const names = (await readdir(packageDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^(?:licen[cs]e|notice|copying|copyright)(?:[._-].*)?$/i.test(entry.name))
      .map(({ name }) => name)
      .sort((left, right) => left.localeCompare(right, "en"));
    const materials = [];
    for (const name of names) materials.push(`[${name}]\n${(await readFile(resolve(packageDirectory, name), "utf8")).trim()}`);
    if (materials.length === 0) {
      const readmeName = (await readdir(packageDirectory)).find((name) => /^readme(?:\..*)?$/i.test(name));
      const readmeSection = readmeName ? readmeLicenseSection(await readFile(resolve(packageDirectory, readmeName), "utf8")) : "";
      const fallback = readmeSection || fallbackLicenseText(item.license);
      if (!fallback) throw new Error(`No distributable license text found for ${item.name}@${item.version} (${item.license}).`);
      materials.push(readmeSection ? `[${readmeName} license section]\n${readmeSection}` : `[SPDX fallback; upstream package supplied no license file]\n${fallback}`);
    }
    sections.push([
      `## ${item.name}@${item.version}`,
      `Declared license: ${item.license}`,
      `Package metadata attribution: ${packageAuthor(manifest.author)}`,
      `Repository: ${packageRepository(manifest.repository)}`,
      "",
      materials.join("\n\n")
    ].join("\n"));
  }
  return [
    "# Third-party production dependency notices",
    "",
    "Generated deterministically from the production lockfile inventory and installed package license/NOTICE material.",
    "When an upstream package omits a license file, its README license section or SPDX reference text is included and the package metadata attribution is retained.",
    "",
    sections.join("\n\n---\n\n"),
    ""
  ].join("\n");
}
