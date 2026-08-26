import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = process.cwd();

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function jsonFiles(relativeDirectory) {
  const directory = resolve(root, relativeDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) return jsonFiles(relativePath);
    return entry.isFile() && entry.name.endsWith(".json") ? [relativePath] : [];
  }));
  return nested.flat();
}

async function validate() {
  const plugin = await readJson(".codex-plugin/plugin.json");
  requireValue(plugin.name === "job-search-copilot", "Plugin name must be job-search-copilot.");
  requireValue(plugin.license === "Apache-2.0", "Plugin license must be Apache-2.0.");
  requireValue(plugin.author?.name === "Jiaqi Xiong", "Plugin author must be Jiaqi Xiong.");
  requireValue(plugin.author?.url === "https://github.com/kikixiong", "Plugin author URL is invalid.");
  requireValue(plugin.homepage === "https://github.com/kikixiong/job-search-copilot", "Plugin homepage is invalid.");
  requireValue(plugin.mcpServers === "./.mcp.json", "Plugin MCP manifest path is invalid.");
  requireValue(plugin.skills === "./skills/", "Plugin skills path is invalid.");
  requireValue(plugin.interface && typeof plugin.interface === "object" && !Array.isArray(plugin.interface), "Plugin interface metadata is missing.");
  const { interface: pluginInterface } = plugin;
  requireValue(pluginInterface.displayName === "Job Search Copilot", "Plugin interface display name is invalid.");
  for (const field of ["shortDescription", "longDescription", "developerName", "category"]) {
    requireValue(nonEmptyString(pluginInterface[field]), `Plugin interface ${field} is required.`);
  }
  requireValue(pluginInterface.developerName === "Jiaqi Xiong", "Plugin interface developer name is invalid.");
  requireValue(Array.isArray(pluginInterface.capabilities) && pluginInterface.capabilities.length > 0 && pluginInterface.capabilities.every(nonEmptyString), "Plugin interface capabilities must be a non-empty string array.");
  requireValue(Array.isArray(pluginInterface.defaultPrompt) && pluginInterface.defaultPrompt.length > 0 && pluginInterface.defaultPrompt.length <= 3 && pluginInterface.defaultPrompt.every(nonEmptyString), "Plugin interface defaultPrompt must contain one to three prompts.");

  const mcp = await readJson(".mcp.json");
  requireValue(mcp.mcpServers && typeof mcp.mcpServers === "object" && !Array.isArray(mcp.mcpServers), "MCP manifest must define an mcpServers object.");
  requireValue((await stat(resolve(root, "skills"))).isDirectory(), "Skills directory is missing.");

  const fixtureFiles = await jsonFiles("fixtures");
  requireValue(fixtureFiles.length > 0, "At least one synthetic fixture is required.");
  for (const relativePath of fixtureFiles) {
    const fixture = await readJson(relativePath);
    requireValue(fixture.fixture === true, `${relativePath} must declare fixture: true.`);
    requireValue(fixture.source === "synthetic", `${relativePath} must declare source: synthetic.`);
  }

  console.log(`Validated plugin configuration and ${fixtureFiles.length} synthetic fixtures.`);
}

validate().catch((error) => {
  console.error(`Configuration validation failed: ${error.message}`);
  process.exitCode = 1;
});
