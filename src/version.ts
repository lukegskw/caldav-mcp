import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageMetadata: unknown = require("../package.json");

if (
  typeof packageMetadata !== "object" ||
  packageMetadata === null ||
  !("version" in packageMetadata) ||
  typeof packageMetadata.version !== "string"
) {
  throw new Error("package.json must contain a string version");
}

export const SERVER_VERSION = packageMetadata.version;
