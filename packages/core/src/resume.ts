import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import * as mammoth from "mammoth";
import PDFParser from "pdf2json";

import { writeGeneratedFile } from "./storage.js";

const MAX_RESUME_BYTES = 20 * 1024 * 1024;
const supportedExtensions = new Set([".txt", ".md", ".markdown", ".pdf", ".docx"]);

async function extractPdf(contents: Buffer) {
  return new Promise<string>((resolve, reject) => {
    const parser = new PDFParser(null, true);
    parser.on("pdfParser_dataError", (error) => {
      parser.destroy();
      reject("parserError" in error ? error.parserError : error);
    });
    parser.on("pdfParser_dataReady", () => {
      const text = parser.getRawTextContent();
      parser.destroy();
      resolve(text);
    });
    parser.parseBuffer(contents, 0);
  });
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
