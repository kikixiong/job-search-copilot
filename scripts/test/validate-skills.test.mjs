import assert from "node:assert/strict";
import test from "node:test";
import { validateSkillText } from "../validate-skills.mjs";

test("skill validator accepts a concise named skill and rejects malformed metadata", () => {
  assert.deepEqual(validateSkillText("---\nname: sample\ndescription: Synthetic sample.\n---\n\n# Sample\n\nDo the work.\n", "sample"), []);
  assert.match(validateSkillText("# Missing metadata\n", "sample").join(" "), /frontmatter/i);
  assert.match(validateSkillText("---\nname: wrong\ndescription: x\n---\nbody\n", "sample").join(" "), /name/i);
});
