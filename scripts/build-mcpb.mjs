import { execFile } from "node:child_process";
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(import.meta.dirname, "..");
const packageMetadata = JSON.parse(
  await readFile(resolve(projectRoot, "package.json"), "utf8"),
);
const outputDirectory = resolve(projectRoot, process.argv[2] ?? "artifacts");
const versionedName = `caldav-mcp-v${packageMetadata.version}.mcpb`;
const stableName = "caldav-mcp.mcpb";
const temporaryRoot = await mkdtemp(join(tmpdir(), "caldav-mcp-mcpb-"));
const extensionDirectory = resolve(temporaryRoot, "extension");
const temporaryBundle = resolve(temporaryRoot, versionedName);
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function runPnpm(args, workingDirectory = projectRoot) {
  const { stdout, stderr } = await execFileAsync(pnpmCommand, args, {
    cwd: workingDirectory,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

try {
  await access(resolve(projectRoot, "dist/main.js"));
  const serverDirectory = resolve(extensionDirectory, "server");
  await mkdir(serverDirectory, { recursive: true });
  await Promise.all([
    cp(resolve(projectRoot, "dist"), resolve(serverDirectory, "dist"), {
      recursive: true,
    }),
    copyFile(
      resolve(projectRoot, "package.json"),
      resolve(serverDirectory, "package.json"),
    ),
    copyFile(
      resolve(projectRoot, "pnpm-lock.yaml"),
      resolve(serverDirectory, "pnpm-lock.yaml"),
    ),
    copyFile(
      resolve(projectRoot, "server.json"),
      resolve(serverDirectory, "server.json"),
    ),
    copyFile(
      resolve(projectRoot, "README.md"),
      resolve(serverDirectory, "README.md"),
    ),
    copyFile(
      resolve(projectRoot, "LICENSE"),
      resolve(serverDirectory, "LICENSE"),
    ),
  ]);
  await runPnpm(
    [
      "install",
      "--prod",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--config.node-linker=hoisted",
    ],
    serverDirectory,
  );
  await copyFile(
    resolve(projectRoot, "integrations/claude-desktop/manifest.json"),
    resolve(extensionDirectory, "manifest.json"),
  );
  await cp(
    resolve(projectRoot, "LICENSE"),
    resolve(extensionDirectory, "LICENSE"),
  );

  await runPnpm([
    "exec",
    "mcpb",
    "validate",
    resolve(extensionDirectory, "manifest.json"),
  ]);
  await runPnpm(["exec", "mcpb", "pack", extensionDirectory, temporaryBundle]);

  await mkdir(outputDirectory, { recursive: true });
  const versionedOutput = resolve(outputDirectory, versionedName);
  const stableOutput = resolve(outputDirectory, stableName);
  await copyFile(temporaryBundle, versionedOutput);
  await copyFile(temporaryBundle, stableOutput);
  process.stdout.write(
    `Created ${basename(versionedOutput)} and ${basename(stableOutput)}\n`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
