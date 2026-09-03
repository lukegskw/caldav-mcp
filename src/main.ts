#!/usr/bin/env node
import {
  createCalDavGateway,
  createCalendarService,
  createMcpServer,
  genericProviderPolicy,
  iCloudProviderPolicy,
  loadConfig,
  type AppConfig,
} from "./index.js";
import { startHttpTransport, startStdioTransport } from "./transports/index.js";

const commandLineTransport = (
  arguments_: readonly string[],
): AppConfig["transport"] | undefined => {
  const optionIndex = arguments_.indexOf("--transport");
  if (optionIndex === -1) {
    return undefined;
  }
  const value = arguments_[optionIndex + 1];
  if (value === "stdio" || value === "streamable-http") {
    return value;
  }
  throw new Error("--transport must be either stdio or streamable-http");
};

const installShutdown = (close: () => Promise<void>): void => {
  let closing = false;
  const shutdown = (): void => {
    if (closing) {
      return;
    }
    closing = true;
    void close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
};

const main = async (): Promise<void> => {
  const override = commandLineTransport(process.argv.slice(2));
  const config = loadConfig(
    override === undefined
      ? process.env
      : { ...process.env, CALDAV_MCP_TRANSPORT: override },
  );
  const provider =
    config.provider === "icloud" ? iCloudProviderPolicy : genericProviderPolicy;
  const service = createCalendarService(createCalDavGateway(config), provider);

  if (config.transport === "stdio") {
    const close = await startStdioTransport(createMcpServer(service));
    installShutdown(close);
    return;
  }

  const transport = await startHttpTransport(service, config);
  console.error(
    `caldav-mcp listening on http://${config.host}:${String(config.port)}/mcp`,
  );
  installShutdown(transport.close);
};

void main().catch(() => {
  console.error("caldav-mcp failed to start");
  process.exitCode = 1;
});
