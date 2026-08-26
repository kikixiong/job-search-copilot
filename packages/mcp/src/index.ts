#!/usr/bin/env node
import { JobSearchService } from "@kikixiong/job-search-copilot-core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./server.js";

const service = new JobSearchService();
const server = createMcpServer({ service });
const transport = new StdioServerTransport();

try {
  await server.connect(transport);
} catch (error) {
  service.close();
  console.error(error);
  process.exitCode = 1;
}
