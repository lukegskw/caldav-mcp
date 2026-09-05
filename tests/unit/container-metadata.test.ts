import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { SERVER_VERSION } from "../../src/version.js";

const readProjectFile = (path: string): Promise<string> =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

describe("container publication metadata", () => {
  it("uses the hardened NAS deployment and GHCR publication contract", async () => {
    const [dockerfile, compose, workflow, releaseWorkflow] = await Promise.all([
      readProjectFile("Dockerfile"),
      readProjectFile("compose.example.yaml"),
      readProjectFile(".github/workflows/container.yml"),
      readProjectFile(".github/workflows/publish.yml"),
    ]);

    expect(dockerfile).toContain("FROM node:24-bookworm-slim");
    expect(dockerfile).toContain("USER caldav");
    expect(dockerfile).not.toContain("COPY .env");
    expect(dockerfile).toContain('ENTRYPOINT ["node", "dist/main.js"]');
    expect(compose).toContain("read_only: true");
    expect(compose).toContain('cap_drop: ["ALL"]');
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("ghcr.io/lukegskw/caldav-mcp:latest");
    expect(compose).not.toContain("volumes:");
    expect(workflow).toContain("platforms: linux/amd64");
    expect(workflow).toContain("push: false");
    expect(workflow).not.toContain("packages: write");
    expect(workflow).not.toContain("docker/login-action");
    expect(releaseWorkflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toMatch(
      /^\s+uses: docker\/build-push-action@[a-f0-9]{40} # v\d+$/m,
    );
    expect(workflow).toContain("needs: quality");
    expect(workflow).toContain("Radicale==3.7.7");
    expect(workflow).toContain("RADICALE_URL");
    expect(workflow).toContain("pnpm test:package");
    expect(workflow).not.toContain("npm publish");
    expect(workflow).not.toContain('tags: ["v*.*.*"]');
  });

  it("keeps release metadata aligned and tests the installable artifact", async () => {
    const [packageJson, serverJson, readme, workflow] = await Promise.all([
      readProjectFile("package.json"),
      readProjectFile("server.json"),
      readProjectFile("README.md"),
      readProjectFile(".github/workflows/publish.yml"),
    ]);

    expect(packageJson).toContain(`"version": "${SERVER_VERSION}"`);
    expect(packageJson).toContain('"caldav-mcp": "dist/main.js"');
    expect(serverJson).toContain(`"version": "${SERVER_VERSION}"`);
    expect(serverJson).toContain(
      `"identifier": "ghcr.io/lukegskw/caldav-mcp:${SERVER_VERSION}"`,
    );
    expect(serverJson).not.toContain('"name": "CALDAV_URL"');
    expect(readme).toContain('"@lukegskw/caldav-mcp@latest"');
    expect(workflow).toContain("branches: [main]");
    expect(workflow).toContain("Create release tag");
    expect(workflow).toContain("should_publish");
    expect(workflow).toContain("container_tags");
    expect(workflow).toContain("${REGISTRY}/${IMAGE_NAME}:latest");
    expect(workflow).toContain("provenance: mode=max");
    expect(workflow).toContain("sbom: true");
    expect(workflow).toContain("pnpm test:package");
    expect(workflow).toContain("pnpm test:distribution");
    expect(workflow).toContain("mcp-publisher validate");
    expect(workflow).toContain("npm publish --provenance");
    expect(workflow).toContain("mcp-publisher publish");
    expect(workflow).toContain("exit 1");
  });
});
