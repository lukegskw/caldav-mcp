import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
const serverMetadata = JSON.parse(await readFile(serverPath, "utf8"));

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

await Promise.all([
  writeFile(packagePath, `${JSON.stringify(packageMetadata, null, 2)}\n`),
  writeFile(serverPath, `${JSON.stringify(serverMetadata, null, 2)}\n`),
]);

process.stdout.write(`Prepared release metadata for ${version}\n`);
