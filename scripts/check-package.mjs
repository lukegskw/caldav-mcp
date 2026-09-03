import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";

const projectRoot = resolve(import.meta.dirname, "..");
const npmEnvironment = { ...process.env };
for (const name of [
  "npm_config_npm_globalconfig",
  "npm_config_verify_deps_before_run",
  "npm_config__jsr_registry",
]) {
  delete npmEnvironment[name];
}
const packageMetadata = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), "caldav-mcp-package-"));

try {
  const packOutput = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", temporaryDirectory],
    { cwd: projectRoot, encoding: "utf8", env: npmEnvironment },
  );
  const packed = JSON.parse(packOutput);
  const filename = packed[0]?.filename;
  if (typeof filename !== "string") {
    throw new Error("npm pack did not return a tarball filename");
  }

  const installDirectory = join(temporaryDirectory, "install");
  await mkdir(installDirectory);
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--no-package-lock",
      "--prefix",
      installDirectory,
      join(temporaryDirectory, filename),
    ],
    { cwd: projectRoot, stdio: "pipe", env: npmEnvironment },
  );

  const executable = join(
    installDirectory,
    "node_modules",
    ".bin",
    "caldav-mcp",
  );
  await access(executable, constants.X_OK);

  const transport = new StdioClientTransport({
    command: executable,
    env: {
      ...getDefaultEnvironment(),
      CALDAV_USERNAME: "package-test@example.com",
      CALDAV_PASSWORD: "not-a-real-password",
    },
    stderr: "pipe",
  });
  let serverErrors = "";
  transport.stderr?.on("data", (chunk) => {
    serverErrors += String(chunk);
  });

  const client = new Client({ name: "package-smoke-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const serverVersion = client.getServerVersion();
    if (serverVersion?.name !== "caldav-mcp") {
      throw new Error(
        `Unexpected MCP server name: ${String(serverVersion?.name)}`,
      );
    }
    if (serverVersion.version !== packageMetadata.version) {
      throw new Error(
        `MCP server version ${serverVersion.version} does not match package version ${packageMetadata.version}`,
      );
    }
    const tools = await client.listTools();
    if (tools.tools.length !== 6) {
      throw new Error(
        `Expected 6 MCP tools, received ${String(tools.tools.length)}`,
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

  console.log(
    `Package smoke test passed for ${packageMetadata.name}@${packageMetadata.version}`,
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
