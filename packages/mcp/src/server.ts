import { JobSearchService } from "@kikixiong/job-search-copilot-core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { createToolRegistry, type ViewerLauncher } from "./tools.js";

export function createMcpServer(options: { service: JobSearchService; viewerLauncher?: ViewerLauncher }) {
  const server = new McpServer({ name: "job-search-copilot", version: "0.1.0" });
  const registry = createToolRegistry(options);
  for (const definition of registry.definitions) {
    server.registerTool(definition.name, { description: definition.description, inputSchema: definition.schema }, async (input) => {
      const result = await registry.invoke(definition.name, input);
      const structuredContent = Array.isArray(result) ? { items: result } : result;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent
      };
    });
  }
  return server;
}
