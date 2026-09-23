import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outputDirectory = join(projectRoot, "build");
const outputPath = join(outputDirectory, "caldav-mcp.mcpb");
const mcpb = join(projectRoot, "node_modules", ".bin", "mcpb");

const packageMetadata = JSON.parse(
  await readFile(join(projectRoot, "package.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(join(projectRoot, "manifest.json"), "utf8"),
);
if (manifest.version !== packageMetadata.version) {
  throw new Error("manifest.json version must equal package.json version");
}

// Staging outside the repository keeps Node from resolving missing bundle dependencies from ../node_modules.
const stagingDirectory = await mkdtemp(join(tmpdir(), "caldav-mcp-mcpb-"));

try {
  for (const file of [
    "manifest.json",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "LICENSE",
    "README.md",
    "PRIVACY.md",
  ]) {
    await cp(join(projectRoot, file), join(stagingDirectory, file));
  }
  await cp(join(projectRoot, "dist"), join(stagingDirectory, "dist"), {
    recursive: true,
  });

  // The hoisted linker produces a flat node_modules without symlinks, which survives zipping on every platform.
  execFileSync(
    "pnpm",
    [
      "install",
      "--prod",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--config.node-linker=hoisted",
    ],
    { cwd: stagingDirectory, stdio: "inherit" },
  );

  await Promise.all(
    [
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "node_modules/.modules.yaml",
      "node_modules/.pnpm",
      "node_modules/.pnpm-workspace-state-v1.json",
    ].map((path) =>
      rm(join(stagingDirectory, path), { recursive: true, force: true }),
    ),
  );

  const bundlePackage = {
    name: packageMetadata.name,
    version: packageMetadata.version,
    description: packageMetadata.description,
    license: packageMetadata.license,
    type: packageMetadata.type,
    engines: packageMetadata.engines,
    dependencies: packageMetadata.dependencies,
  };
  await writeFile(
    join(stagingDirectory, "package.json"),
    `${JSON.stringify(bundlePackage, null, 2)}\n`,
  );
  await writeFile(join(stagingDirectory, ".mcpbignore"), "*.d.ts\n");

  execFileSync(mcpb, ["validate", join(stagingDirectory, "manifest.json")], {
    stdio: "inherit",
  });
  await mkdir(outputDirectory, { recursive: true });
  await rm(outputPath, { force: true });
  execFileSync(mcpb, ["pack", stagingDirectory, outputPath], {
    stdio: "inherit",
  });
} finally {
  await rm(stagingDirectory, { recursive: true, force: true });
}

const digest = createHash("sha256")
  .update(await readFile(outputPath))
  .digest("hex");
process.stdout.write(`Built ${outputPath}\nSHA-256 ${digest}\n`);
