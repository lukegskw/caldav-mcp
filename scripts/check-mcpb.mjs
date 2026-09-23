import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";

const projectRoot = resolve(import.meta.dirname, "..");
const bundlePath = join(projectRoot, "build", "caldav-mcp.mcpb");
const mcpb = join(projectRoot, "node_modules", ".bin", "mcpb");
const packageMetadata = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "caldav-mcp-bundle-"));

try {
  execFileSync(mcpb, ["unpack", bundlePath, temporaryDirectory], {
    stdio: "pipe",
  });
  const manifest = JSON.parse(
    await readFile(join(temporaryDirectory, "manifest.json"), "utf8"),
  );
  const userConfig = {
    username: "bundle-test@example.com",
    password: "not-a-real-password",
  };
  // Mirror the host's substitution of ${__dirname} and ${user_config.*}.
  const substitute = (value) =>
    value
      .replaceAll("${__dirname}", temporaryDirectory)
      .replace(/\$\{user_config\.([a-z_]+)\}/g, (_, key) => {
        if (!(key in userConfig)) {
          throw new Error(`Unexpected user_config reference: ${key}`);
        }
        return userConfig[key];
      });
  const { command, args, env } = manifest.server.mcp_config;
  const listedTools = manifest.tools.map((tool) => tool.name).sort();

  const transport = new StdioClientTransport({
    // Hosts run "node" with their own runtime; use the current one here.
    command: command === "node" ? process.execPath : command,
    args: args.map(substitute),
    cwd: temporaryDirectory,
    env: {
      ...getDefaultEnvironment(),
      ...Object.fromEntries(
        Object.entries(env).map(([name, value]) => [name, substitute(value)]),
      ),
    },
    stderr: "pipe",
  });
  let serverErrors = "";
  transport.stderr?.on("data", (chunk) => {
    serverErrors += String(chunk);
  });

  const client = new Client({ name: "bundle-smoke-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const serverVersion = client.getServerVersion();
    if (serverVersion?.version !== packageMetadata.version) {
      throw new Error(
        `Bundled server version ${String(serverVersion?.version)} does not match package version ${packageMetadata.version}`,
      );
    }
    const tools = (await client.listTools()).tools
      .map((tool) => tool.name)
      .sort();
    if (JSON.stringify(tools) !== JSON.stringify(listedTools)) {
      throw new Error(
        `manifest.json tools ${listedTools.join(", ")} do not match server tools ${tools.join(", ")}`,
      );
    }
  } catch (error) {
    if (serverErrors !== "") {
      process.stderr.write(serverErrors);
    }
    throw error;
  } finally {
    await client.close();
  }

  process.stdout.write(
    `Bundle smoke test passed for caldav-mcp.mcpb@${packageMetadata.version} on Node.js ${process.version}\n`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
