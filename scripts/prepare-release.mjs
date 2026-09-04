import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { format } from "prettier";

const version = process.argv[2];
if (
  version === undefined ||
  !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
    version,
  )
) {
  throw new Error("Usage: pnpm release:prepare <semantic-version>");
}

const projectRoot = resolve(import.meta.dirname, "..");
const packagePath = resolve(projectRoot, "package.json");
const serverPath = resolve(projectRoot, "server.json");
const geminiPath = resolve(projectRoot, "gemini-extension.json");
const claudePluginPath = resolve(
  projectRoot,
  "plugins/caldav-mcp/.claude-plugin/plugin.json",
);
const codexPluginPath = resolve(
  projectRoot,
  "plugins/caldav-mcp/.codex-plugin/plugin.json",
);
const mcpbManifestPath = resolve(
  projectRoot,
  "integrations/claude-desktop/manifest.json",
);
const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
const serverMetadata = JSON.parse(await readFile(serverPath, "utf8"));
const geminiMetadata = JSON.parse(await readFile(geminiPath, "utf8"));
const claudePluginMetadata = JSON.parse(
  await readFile(claudePluginPath, "utf8"),
);
const codexPluginMetadata = JSON.parse(await readFile(codexPluginPath, "utf8"));
const mcpbManifest = JSON.parse(await readFile(mcpbManifestPath, "utf8"));

async function writeJson(path, value) {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, await format(json, { filepath: path }));
}

if (!Array.isArray(serverMetadata.packages)) {
  throw new Error("server.json must contain a packages array");
}

const npmPackage = serverMetadata.packages.find(
  (entry) => entry?.registryType === "npm",
);
const ociPackage = serverMetadata.packages.find(
  (entry) => entry?.registryType === "oci",
);
if (
  npmPackage === undefined ||
  ociPackage === undefined ||
  typeof ociPackage.identifier !== "string" ||
  !/:[^/]+$/.test(ociPackage.identifier)
) {
  throw new Error("server.json must contain versioned npm and OCI packages");
}

packageMetadata.version = version;
serverMetadata.version = version;
npmPackage.version = version;
ociPackage.identifier = ociPackage.identifier.replace(/:[^/]+$/, `:${version}`);
geminiMetadata.version = version;
claudePluginMetadata.version = version;
codexPluginMetadata.version = version;
mcpbManifest.version = version;

await Promise.all([
  writeJson(packagePath, packageMetadata),
  writeJson(serverPath, serverMetadata),
  writeJson(geminiPath, geminiMetadata),
  writeJson(claudePluginPath, claudePluginMetadata),
  writeJson(codexPluginPath, codexPluginMetadata),
  writeJson(mcpbManifestPath, mcpbManifest),
]);

process.stdout.write(`Prepared release metadata for ${version}\n`);
