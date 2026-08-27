import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Version } from "@cyclonedx/cyclonedx-library/Spec";
import { JsonValidator } from "@cyclonedx/cyclonedx-library/Validation";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function validateCycloneDxJson(json) {
  return new JsonValidator(Version.v1dot6).validate(json);
}

async function main() {
  const path = resolve(repositoryRoot, process.argv[2] ?? "release/job-search-copilot-0.1.0.cdx.json");
  const error = await validateCycloneDxJson(await readFile(path, "utf8"));
  if (error) throw new Error(`CycloneDX 1.6 schema validation failed: ${JSON.stringify(error)}`);
  console.log("CycloneDX 1.6 schema validation passed with the official CycloneDX library.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
