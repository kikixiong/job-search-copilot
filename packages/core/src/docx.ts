import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

const officeDocumentRelationship = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const wordprocessingNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const MAX_DOCX_ENTRIES = 2_048;
const MAX_DOCX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_RELATIONSHIPS_BYTES = 1024 * 1024;

type SizedZipObject = JSZip.JSZipObject & { _data?: { uncompressedSize?: number } };

function validateArchiveMetadata(archive: JSZip) {
  const entries = Object.values(archive.files) as SizedZipObject[];
  if (entries.length > MAX_DOCX_ENTRIES) throw new Error(`DOCX archive exceeds the ${MAX_DOCX_ENTRIES}-entry limit.`);
  let total = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const size = entry._data?.uncompressedSize;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) throw new Error(`DOCX entry has invalid uncompressed-size metadata: ${entry.name}`);
    if (size > MAX_DOCX_ENTRY_BYTES) throw new Error(`DOCX entry exceeds the ${MAX_DOCX_ENTRY_BYTES}-byte uncompressed size limit: ${entry.name}`);
    total += size;
    if (total > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES) throw new Error(`DOCX archive exceeds the ${MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES}-byte total uncompressed size limit.`);
  }
}

async function expandEntry(entry: JSZip.JSZipObject, label: string, limit: number) {
  const contents = await entry.async("nodebuffer");
  if (contents.length > limit) throw new Error(`${label} exceeds the ${limit}-byte expanded size limit.`);
  return contents;
}

function parseXml(source: string, label: string) {
  const errors: string[] = [];
  const document = new DOMParser({
    errorHandler(level, message) {
      if (level !== "warning") errors.push(String(message));
    }
  }).parseFromString(source, "application/xml");
  if (errors.length > 0) throw new Error(`Invalid ${label} XML: ${errors.join("; ")}`);
  return document;
}

function mainDocumentPath(relationships: string) {
  const document = parseXml(relationships, "DOCX relationships");
  const nodes = document.getElementsByTagName("Relationship");
  for (let index = 0; index < nodes.length; index += 1) {
    const relationship = nodes.item(index);
    if (relationship?.getAttribute("Type") !== officeDocumentRelationship) continue;
    const target = relationship.getAttribute("Target")?.replaceAll("\\", "/").replace(/^\/+/, "");
    if (!target || target.split("/").some((part) => part === "..")) throw new Error("DOCX main document relationship has an unsafe target.");
    return target;
  }
  throw new Error("DOCX does not declare a main document relationship.");
}

function childText(node: Node): string {
  let output = "";
  for (let child = node.firstChild; child; child = child.nextSibling) output += documentText(child);
  return output;
}

function documentText(node: Node): string {
  if (node.nodeType !== node.ELEMENT_NODE) return "";
  const element = node as Element;
  if (element.namespaceURI !== wordprocessingNamespace) return childText(element);
  if (element.localName === "t") return element.textContent ?? "";
  if (element.localName === "tab") return "\t";
  if (element.localName === "br" || element.localName === "cr") return "\n";
  const contents = childText(element);
  if (element.localName === "p" || element.localName === "tr") return `${contents}\n`;
  if (element.localName === "tc") return `${contents}\t`;
  return contents;
}

export async function extractDocxText(contents: Buffer) {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(contents);
  } catch (error) {
    throw new Error(`Invalid DOCX archive: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  validateArchiveMetadata(archive);
  const relationshipsEntry = archive.file("_rels/.rels");
  if (!relationshipsEntry) throw new Error("DOCX is missing _rels/.rels.");
  const relationships = await expandEntry(relationshipsEntry, "DOCX relationships", MAX_RELATIONSHIPS_BYTES);
  const path = mainDocumentPath(relationships.toString("utf8"));
  const documentEntry = archive.file(path);
  if (!documentEntry) throw new Error(`DOCX is missing its main document part: ${path}.`);
  const documentContents = await expandEntry(documentEntry, "DOCX main document", MAX_DOCX_ENTRY_BYTES);
  const document = parseXml(documentContents.toString("utf8"), "DOCX document");
  return documentText(document.documentElement)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
