import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { SERVER_VERSION } from "../../src/version.js";

const readProjectFile = (path: string): Promise<string> =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

describe("container publication metadata", () => {
  it("uses the hardened NAS deployment and GHCR publication contract", async () => {
    const [dockerfile, compose, workflow] = await Promise.all([
      readProjectFile("Dockerfile"),
      readProjectFile("compose.example.yaml"),
      readProjectFile(".github/workflows/container.yml"),
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
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("docker/build-push-action@v7");
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
    expect(readme).toContain(`"@lukegskw/caldav-mcp@${SERVER_VERSION}"`);
    expect(workflow).toContain('tags: ["v*.*.*"]');
    expect(workflow).toContain("pnpm test:package");
    expect(workflow).toContain("mcp-publisher validate");
    expect(workflow).toContain("npm publish --provenance");
    expect(workflow).toContain("mcp-publisher publish");
    expect(workflow).toContain("exit 1");
  });
});
