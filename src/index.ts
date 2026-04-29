#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAnalyzeTool } from "./tools/analyze.js";
import { registerExplainTool } from "./tools/explain.js";
import { registerHypotheticalTool } from "./tools/hypothetical.js";
import { registerCloneTool } from "./tools/clone.js";
import { registerCannibalizeTool } from "./tools/cannibalize.js";
import { registerDiffTool } from "./tools/diff.js";
import { registerSetupTool } from "./tools/setup.js";
import { registerStatusTool } from "./tools/status.js";

const server = new McpServer({
  name: "reconstruct",
  version: "0.1.0",
});

// Register all tools
registerAnalyzeTool(server);
registerExplainTool(server);
registerHypotheticalTool(server);
registerCloneTool(server);
registerCannibalizeTool(server);
registerDiffTool(server);
registerSetupTool(server);
registerStatusTool(server);

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
