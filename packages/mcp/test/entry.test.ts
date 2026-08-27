import assert from "node:assert/strict";
import { access, chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { viewerRuntimeOptions } from "../src/runtime.js";

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

test("release smoke mode installs a no-op browser opener", async () => {
  const options = viewerRuntimeOptions({ JOB_SEARCH_COPILOT_NO_BROWSER: "1" });
  assert.equal(typeof options.openBrowser, "function");
  await options.openBrowser?.("http://127.0.0.1:1234/");
});

test("stdio entry can expose the Viewer without launching a browser in release smoke mode", async () => {
  const temp = await mkdtemp(join(tmpdir(), "job-search-entry-smoke-"));
  const sentinel = join(temp, "browser-opened");
  const fakeOpener = "#!/bin/sh\n: > \"$JOB_SEARCH_COPILOT_BROWSER_SENTINEL\"\n";
  for (const command of ["open", "xdg-open"]) {
    await writeFile(join(temp, command), fakeOpener);
    await chmod(join(temp, command), 0o755);
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("node_modules/tsx/dist/cli.mjs"), resolve("packages/mcp/src/index.ts")],
    cwd: resolve("."),
    env: {
      PATH: temp,
      JOB_SEARCH_COPILOT_NO_BROWSER: "1",
      JOB_SEARCH_COPILOT_BROWSER_SENTINEL: sentinel,
      JOB_SEARCH_COPILOT_DATA_DIR: join(temp, "data")
    },
    stderr: "pipe"
  });
  const client = new Client({ name: "release-smoke-test", version: "0.1.0" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map(({ name }) => name), expectedTools);
    const opened = await client.callTool({ name: "workspace_open", arguments: { name: "Synthetic release smoke" } });
    const workspaceId = (opened.structuredContent as { id: string }).id;
    const viewer = await client.callTool({ name: "viewer_open", arguments: { workspaceId } });
    assert.equal((viewer.structuredContent as { available: boolean }).available, true);
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    await assert.rejects(access(sentinel), /ENOENT/);
    assert.deepEqual((await client.listTools()).tools.map(({ name }) => name), expectedTools);
  } finally {
    await client.close();
  }
});
