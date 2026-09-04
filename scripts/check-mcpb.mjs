import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const bundlePath = resolve(
  projectRoot,
  process.argv[2] ?? "artifacts/caldav-mcp.mcpb",
);
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "caldav-mcp-check-mcpb-"),
);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

try {
  await access(bundlePath);
  await execFileAsync(
    pnpmCommand,
    ["exec", "mcpb", "unpack", bundlePath, temporaryDirectory],
    { cwd: projectRoot },
  );

  const [packageMetadata, manifest] = await Promise.all([
    readFile(resolve(projectRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(resolve(temporaryDirectory, "manifest.json"), "utf8").then(
      JSON.parse,
    ),
  ]);
  if (manifest.version !== packageMetadata.version) {
    throw new Error(
      `MCPB version ${String(manifest.version)} does not match package version ${String(packageMetadata.version)}`,
    );
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(temporaryDirectory, manifest.server.entry_point)],
    env: {
      ...getDefaultEnvironment(),
      CALDAV_USERNAME: "mcpb-test@example.com",
      CALDAV_PASSWORD: "not-a-real-password",
    },
    stderr: "pipe",
  });
  let serverErrors = "";
  transport.stderr?.on("data", (chunk) => {
    serverErrors += String(chunk);
  });

  const client = new Client({ name: "mcpb-smoke-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const serverVersion = client.getServerVersion();
    if (serverVersion?.version !== packageMetadata.version) {
      throw new Error(
        `Bundled server version ${String(serverVersion?.version)} does not match ${String(packageMetadata.version)}`,
      );
    }
    const tools = await client.listTools();
    if (tools.tools.length !== 6) {
      throw new Error(
        `Expected 6 MCP tools in the bundle, received ${String(tools.tools.length)}`,
      );
    }
  } catch (error) {
    if (serverErrors !== "") process.stderr.write(serverErrors);
    throw error;
  } finally {
    await client.close();
  }

  process.stdout.write(`MCPB smoke test passed for ${bundlePath}\n`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
