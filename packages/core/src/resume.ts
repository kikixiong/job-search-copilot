import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as mammoth from "mammoth";

import { writeGeneratedFile } from "./storage.js";

const MAX_RESUME_BYTES = 20 * 1024 * 1024;
const supportedExtensions = new Set([".txt", ".md", ".markdown", ".pdf", ".docx"]);
declare const __JOB_SEARCH_COPILOT_BUNDLED__: boolean | undefined;

async function extractPdf(contents: Buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const assetRoot = typeof __JOB_SEARCH_COPILOT_BUNDLED__ !== "undefined" && __JOB_SEARCH_COPILOT_BUNDLED__
    ? new URL("../pdfjs/", import.meta.url)
    : new URL("../../", import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(contents),
    standardFontDataUrl: fileURLToPath(new URL("standard_fonts/", assetRoot)),
    cMapUrl: fileURLToPath(new URL("cmaps/", assetRoot)),
    cMapPacked: true,
    wasmUrl: fileURLToPath(new URL("wasm/", assetRoot))
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.flatMap((item) => ("str" in item ? [item.str] : [])).join(" "));
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages.join("\n");
}

async function extractText(extension: string, contents: Buffer) {
  if (extension === ".txt" || extension === ".md" || extension === ".markdown") return contents.toString("utf8");
  if (extension === ".pdf") return extractPdf(contents);
  const result = await mammoth.extractRawText({ buffer: contents });
  return result.value;
}

export async function inspectResume(sourcePath: string) {
  let metadata;
  try {
    metadata = await stat(sourcePath);
  } catch {
    throw new Error(`Resume file does not exist: ${sourcePath}`);
  }
  if (!metadata.isFile()) throw new Error("Resume source must be a regular file, not a directory or special file.");
  const extension = extname(sourcePath).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    throw new Error("Supported types are text PDF, DOCX, TXT, Markdown (.md), and .markdown files.");
  }
  if (metadata.size > MAX_RESUME_BYTES) throw new Error("Resume exceeds the 20 MiB size limit.");
  const contents = await readFile(sourcePath);
  if (contents.length > MAX_RESUME_BYTES) throw new Error("Resume exceeds the 20 MiB size limit.");
  const extractedText = (await extractText(extension, contents)).trim();
  if (!extractedText) throw new Error("Resume has no extractable text. Use a text-based PDF, DOCX, TXT, or Markdown file.");
  return {
    contents,
    extension,
    extractedText,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

export async function storeResumeCopy(contents: Buffer, destinationPath: string, dataRoot: string) {
  await writeGeneratedFile(dataRoot, destinationPath, contents);
}
