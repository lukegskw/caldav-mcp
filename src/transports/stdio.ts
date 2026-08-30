import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { withSchemaDialectFix } from "../tools/schema-dialect.js";

export const startStdioTransport = async (
  server: McpServer,
): Promise<() => Promise<void>> => {
  const transport = withSchemaDialectFix(new StdioServerTransport());
  await server.connect(transport);
  return async () => {
    await transport.close();
    await server.close();
  };
};
