import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

const officeDocumentRelationship = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const wordprocessingNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

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
  const relationshipsEntry = archive.file("_rels/.rels");
  if (!relationshipsEntry) throw new Error("DOCX is missing _rels/.rels.");
  const path = mainDocumentPath(await relationshipsEntry.async("string"));
  const documentEntry = archive.file(path);
  if (!documentEntry) throw new Error(`DOCX is missing its main document part: ${path}.`);
  const document = parseXml(await documentEntry.async("string"), "DOCX document");
  return documentText(document.documentElement)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
