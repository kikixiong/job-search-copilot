import { gzipSync } from "node:zlib";

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
      return { name, version: item.version, license: extra.license ?? item.license ?? "NOASSERTION", repository: extra.repository ?? null, integrity: item.integrity ?? null };
    });
  return [...new Map(packages.map((item) => [`${item.name}@${item.version}`, item])).values()]
    .sort((left, right) => `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, "en"));
}

export function incompatibleLicenses(packages) {
  return packages
    .filter(({ license }) => !license || /(?:NOASSERTION|UNLICENSED|AGPL|SSPL)/i.test(license))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

export function createCycloneDx(lock, metadata = new Map()) {
  const components = productionPackages(lock, metadata).map((item) => ({
    type: "library",
    "bom-ref": npmPurl(item.name, item.version),
    name: item.name,
    version: item.version,
    licenses: [{ license: { id: item.license } }],
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
