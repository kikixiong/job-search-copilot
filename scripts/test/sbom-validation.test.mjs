import assert from "node:assert/strict";
import test from "node:test";

import { createCycloneDx } from "../release-lib.mjs";

async function validatorModule() {
  try { return await import("../validate-sbom.mjs"); } catch { return {}; }
}

test("official CycloneDX library validates the generated 1.6 JSON with SPDX expressions", async () => {
  const { validateCycloneDxJson } = await validatorModule();
  assert.equal(typeof validateCycloneDxJson, "function", "official CycloneDX validation is not implemented");
  const bom = createCycloneDx({
    name: "job-search-copilot",
    version: "0.1.0",
    packages: {
      "node_modules/choice": { version: "1.0.0", license: "(MIT OR GPL-3.0-or-later)" },
      "node_modules/combined": { version: "1.0.0", license: "(MIT AND Zlib)" }
    }
  });

  assert.equal(await validateCycloneDxJson(JSON.stringify(bom)), null);
});
