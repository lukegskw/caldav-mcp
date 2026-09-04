import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(projectRoot, relativePath), "utf8"));
}

function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function checkNpxLatest(server, label) {
  check(server?.command === "npx", `${label} must use npx`);
  check(
    Array.isArray(server.args) &&
      server.args.includes("@lukegskw/caldav-mcp@latest"),
    `${label} must launch @lukegskw/caldav-mcp@latest`,
  );
}

const [packageMetadata, serverMetadata, geminiMetadata] = await Promise.all([
  readJson("package.json"),
  readJson("server.json"),
  readJson("gemini-extension.json"),
]);

const version = packageMetadata.version;
const repositoryUrl = "https://github.com/lukegskw/caldav-mcp";
check(
  typeof version === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(
      version,
    ),
  "package.json must contain a semantic version",
);
check(
  packageMetadata.mcpName === "io.github.lukegskw/caldav-mcp" &&
    serverMetadata.name === packageMetadata.mcpName,
  "MCP Registry name must match package.json mcpName",
);
check(
  packageMetadata.repository?.url === `${repositoryUrl}.git`,
  "package.json repository URL is unexpected",
);

for (const [label, candidate] of [
  ["server.json", serverMetadata.version],
  ["gemini-extension.json", geminiMetadata.version],
]) {
  check(candidate === version, `${label} version must equal ${version}`);
}

const npmPackage = serverMetadata.packages?.find(
  (entry) => entry.registryType === "npm",
);
const ociPackage = serverMetadata.packages?.find(
  (entry) => entry.registryType === "oci",
);
check(npmPackage?.version === version, "MCP Registry npm version is stale");
check(
  ociPackage?.identifier === `ghcr.io/lukegskw/caldav-mcp:${version}`,
  "MCP Registry OCI tag is stale",
);

checkNpxLatest(
  geminiMetadata.mcpServers?.["icloud-calendar"],
  "Gemini extension",
);

check(
  geminiMetadata.settings?.some(
    (setting) => setting.envVar === "CALDAV_PASSWORD" && setting.sensitive,
  ),
  "Gemini password setting must be sensitive",
);
check(
  geminiMetadata.name === "caldav-mcp",
  "Gemini extension name is unexpected",
);
process.stdout.write(
  `Distribution metadata is consistent at version ${version}\n`,
);
