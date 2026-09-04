import { access, readFile } from "node:fs/promises";
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

const [
  packageMetadata,
  serverMetadata,
  geminiMetadata,
  claudePluginMetadata,
  claudeMcpMetadata,
  codexPluginMetadata,
  codexMcpMetadata,
  mcpbManifest,
  claudeMarketplace,
  codexMarketplace,
] = await Promise.all([
  readJson("package.json"),
  readJson("server.json"),
  readJson("gemini-extension.json"),
  readJson("plugins/caldav-mcp/.claude-plugin/plugin.json"),
  readJson("plugins/caldav-mcp/claude.mcp.json"),
  readJson("plugins/caldav-mcp/.codex-plugin/plugin.json"),
  readJson("plugins/caldav-mcp/.mcp.json"),
  readJson("integrations/claude-desktop/manifest.json"),
  readJson(".claude-plugin/marketplace.json"),
  readJson(".agents/plugins/marketplace.json"),
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
  ["Claude Code plugin", claudePluginMetadata.version],
  ["Codex plugin", codexPluginMetadata.version],
  ["Claude Desktop MCPB", mcpbManifest.version],
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
checkNpxLatest(
  claudeMcpMetadata.mcpServers?.["icloud-calendar"],
  "Claude Code plugin",
);
checkNpxLatest(
  codexMcpMetadata.mcpServers?.["icloud-calendar"],
  "Codex plugin",
);

check(
  geminiMetadata.settings?.some(
    (setting) => setting.envVar === "CALDAV_PASSWORD" && setting.sensitive,
  ),
  "Gemini password setting must be sensitive",
);
check(
  claudePluginMetadata.userConfig?.caldav_password?.sensitive === true,
  "Claude Code password setting must be sensitive",
);
check(
  mcpbManifest.user_config?.caldav_password?.sensitive === true,
  "Claude Desktop password setting must be sensitive",
);
check(
  mcpbManifest.server?.entry_point === "server/dist/main.js",
  "Claude Desktop entry point is unexpected",
);
for (const [label, metadata] of [
  ["Gemini extension", geminiMetadata],
  ["Claude Code plugin", claudePluginMetadata],
  ["Codex plugin", codexPluginMetadata],
  ["Claude Desktop MCPB", mcpbManifest],
]) {
  check(metadata.name === "caldav-mcp", `${label} name is unexpected`);
}
check(
  claudePluginMetadata.repository === repositoryUrl &&
    codexPluginMetadata.repository === repositoryUrl &&
    mcpbManifest.repository?.url === `${repositoryUrl}.git`,
  "Client manifest repository URLs are inconsistent",
);

check(
  claudeMarketplace.plugins?.some(
    (plugin) =>
      plugin.name === "caldav-mcp" && plugin.source === "./plugins/caldav-mcp",
  ),
  "Claude marketplace must expose plugins/caldav-mcp",
);
check(
  codexMarketplace.plugins?.some(
    (plugin) =>
      plugin.name === "caldav-mcp" &&
      plugin.source?.path === "./plugins/caldav-mcp",
  ),
  "Codex marketplace must expose plugins/caldav-mcp",
);

await Promise.all([
  access(resolve(projectRoot, "PRIVACY.md")),
  access(resolve(projectRoot, "plugins/caldav-mcp")),
]);
process.stdout.write(
  `Distribution metadata is consistent at version ${version}\n`,
);
