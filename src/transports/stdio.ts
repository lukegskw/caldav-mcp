import type { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

export const startStdioTransport = async (
  server: McpServer,
): Promise<() => Promise<void>> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return async () => {
    await transport.close();
    await server.close();
  };
};
