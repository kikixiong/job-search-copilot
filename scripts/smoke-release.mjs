import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import JSZip from "jszip";

const expectedTools = [
  "workspace_open",
  "resume_import",
  "profile_commit",
  "search_run_begin",
  "search_record_batch",
  "search_run_finish",
  "opportunities_query",
  "feedback_record",
  "application_packet_upsert",
  "application_packet_review",
  "workspace_export",
  "viewer_open"
];

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

export function staticAssetPaths(html) {
  return [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)]
    .map((match) => match[1])
    .filter((path) => !/^(?:data:|https?:|\/\/)/i.test(path));
}

function structured(result) {
  if (!result.structuredContent || typeof result.structuredContent !== "object") throw new Error(`MCP tool result omitted structuredContent: ${JSON.stringify(result.content)}`);
  return result.structuredContent;
}

function syntheticPdf(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${text.length + 31} >>\nstream\nBT /F1 12 Tf 20 100 Td (${text}) Tj ET\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((value) => `${String(value).padStart(10, "0")} 00000 n \n`).join("");
  output += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

async function syntheticDocx(text) {
  const archive = new JSZip();
  archive.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  archive.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  archive.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function syntheticResumeFixtures() {
  return [
    { name: "synthetic-resume.pdf", contents: syntheticPdf("Synthetic packaged PDF analyst"), expected: "Synthetic packaged PDF analyst" },
    { name: "synthetic-resume.docx", contents: await syntheticDocx("Synthetic packaged DOCX engineer"), expected: "Synthetic packaged DOCX engineer" },
    { name: "synthetic-resume.txt", contents: Buffer.from("Synthetic packaged TXT researcher\n"), expected: "Synthetic packaged TXT researcher" },
    { name: "synthetic-resume.md", contents: Buffer.from("# Synthetic packaged Markdown scientist\n"), expected: "Synthetic packaged Markdown scientist" }
  ];
}

export async function runReleaseSmoke() {
  const extractionRoot = await mkdtemp(join(tmpdir(), "job-search-isolated-release-"));
  let client;
  try {
    await execFileAsync("tar", ["-xzf", join(repositoryRoot, "release/job-search-copilot-0.1.0.tgz"), "-C", extractionRoot]);
    const pluginRoot = join(extractionRoot, "job-search-copilot");
    for (let current = pluginRoot; ; current = dirname(current)) {
      await assert.rejects(access(join(current, "node_modules")), undefined, `Smoke ancestor contains node_modules: ${current}`);
      if (current === parse(current).root) break;
    }
    const manifest = JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8"));
    const definition = manifest.mcpServers?.["job-search-copilot"];
    assert.deepEqual(definition, { command: "node", args: ["dist/mcp/index.js"], cwd: "." });
    const arbitraryCallerDirectory = join(extractionRoot, "caller");
    await mkdir(arbitraryCallerDirectory);
    const dataRoot = join(arbitraryCallerDirectory, "data");
    const transport = new StdioClientTransport({
      command: definition.command,
      args: definition.args,
      cwd: resolve(pluginRoot, definition.cwd),
      env: { PATH: process.env.PATH ?? "", JOB_SEARCH_COPILOT_NO_BROWSER: "1", JOB_SEARCH_COPILOT_DATA_DIR: dataRoot },
      stderr: "pipe"
    });
    client = new Client({ name: "job-search-release-smoke", version: "0.1.0" });
    await client.connect(transport);
    assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), expectedTools);
    const workspace = structured(await client.callTool({ name: "workspace_open", arguments: { name: "Synthetic packaged smoke" } }));
    const resumeFixtures = await syntheticResumeFixtures();
    for (const fixture of resumeFixtures) {
      const resumePath = join(arbitraryCallerDirectory, fixture.name);
      await writeFile(resumePath, fixture.contents);
      const imported = structured(await client.callTool({ name: "resume_import", arguments: { workspaceId: workspace.id, sourcePath: resumePath } }));
      assert.match(imported.extractedText, new RegExp(fixture.expected));
    }
    const launched = structured(await client.callTool({ name: "viewer_open", arguments: { workspaceId: workspace.id } }));
    assert.equal(launched.available, true);
    const exchange = await fetch(launched.url, { redirect: "manual" });
    assert.equal(exchange.status, 303);
    const cookie = exchange.headers.get("set-cookie")?.split(";", 1)[0];
    const location = exchange.headers.get("location");
    assert.ok(cookie && location);
    const cleanUrl = new URL(location, launched.url).toString();
    assert.equal((await fetch(new URL("api/snapshot", cleanUrl))).status, 401);
    assert.equal((await fetch(new URL("api/snapshot", cleanUrl), { headers: { cookie } })).status, 200);
    const page = await fetch(cleanUrl, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    const html = await page.text();
    const assets = staticAssetPaths(html);
    assert.ok(assets.length >= 2, "Viewer page must reference bundled JS and CSS assets.");
    for (const asset of assets) assert.equal((await fetch(new URL(asset, cleanUrl), { headers: { cookie } })).status, 200, asset);
    console.log(`Isolated archive smoke passed: ${expectedTools.length} MCP tools, bundled PDF/DOCX/TXT/Markdown imports, Viewer auth, and ${assets.length} static assets.`);
  } finally {
    try {
      if (client) await client.close();
    } finally {
      await rm(extractionRoot, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runReleaseSmoke().catch((error) => {
    console.error(`Release smoke failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
