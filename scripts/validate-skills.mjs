import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function validateSkillText(text, expectedName) {
  const issues = [];
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]+)$/);
  if (!match) return ["SKILL.md must contain YAML frontmatter and a non-empty body."];
  const fields = Object.fromEntries(match[1].split("\n").map((line) => {
    const separator = line.indexOf(":");
    return separator < 0 ? [line.trim(), ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
  }));
  if (fields.name !== expectedName) issues.push(`Skill name must equal directory name ${expectedName}.`);
  if (!fields.description) issues.push("Skill description is required.");
  if (text.split("\n").length > 500) issues.push("Skill must not exceed 500 lines.");
  if (!match[2].trim()) issues.push("Skill body is required.");
  return issues;
}

export async function validateSkills(root = process.cwd()) {
  const skillsRoot = resolve(root, "skills");
  const directories = (await readdir(skillsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((left, right) => left.name.localeCompare(right.name, "en"));
  const issues = [];
  for (const directory of directories) {
    const path = join(skillsRoot, directory.name, "SKILL.md");
    const text = await readFile(path, "utf8");
    issues.push(...validateSkillText(text, directory.name).map((issue) => `${path}: ${issue}`));
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = resolve(dirname(path), match[1]);
      try { await access(target); } catch { issues.push(`${path}: referenced file does not exist: ${match[1]}`); }
    }
  }
  if (directories.length !== 5) issues.push(`Expected exactly 5 skills, found ${directories.length}.`);
  return { count: directories.length, issues };
}

async function main() {
  const result = await validateSkills();
  if (result.issues.length) throw new Error(result.issues.join("\n"));
  console.log(`Validated ${result.count} skills and their local references.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Skill validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
