import assert from "node:assert/strict";
import test from "node:test";

async function configValidator() {
  try { return await import("../validate-config.mjs"); } catch { return {}; }
}

test("workflow action pin validation requires full SHAs with reviewed major-version comments", async () => {
  const { validateActionPins } = await configValidator();
  assert.equal(typeof validateActionPins, "function", "workflow action pin validator is not implemented");
  const checkout = "11d5960a326750d5838078e36cf38b85af677262";
  const setupNode = "49933ea5288caeca8642d1e84afbd3f7d6820020";
  assert.doesNotThrow(() => validateActionPins(`
steps:
  - uses: actions/checkout@${checkout} # v4
  - uses: actions/setup-node@${setupNode} # v4
`));
  assert.throws(() => validateActionPins(`
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@${setupNode} # v4
`), /checkout.*40-character|checkout.*SHA/i);
  assert.throws(() => validateActionPins(`
steps:
  - uses: actions/checkout@${checkout}
  - uses: actions/setup-node@${setupNode} # v4
`), /checkout.*version comment|checkout.*# v4/i);
});
