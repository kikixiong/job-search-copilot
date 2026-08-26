#!/usr/bin/env node
import { JobSearchService } from "@kikixiong/job-search-copilot-core";
import { createViewerLauncher } from "@kikixiong/job-search-copilot-viewer";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./server.js";
import { viewerRuntimeOptions } from "./runtime.js";

const service = new JobSearchService();
const viewerLauncher = createViewerLauncher({ service, ...viewerRuntimeOptions(process.env) });
const server = createMcpServer({ service, viewerLauncher });
const transport = new StdioServerTransport();

try {
  await server.connect(transport);
} catch (error) {
  await viewerLauncher.close();
  service.close();
  console.error(error);
  process.exitCode = 1;
}
