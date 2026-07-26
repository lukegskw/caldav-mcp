import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

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
    expect(workflow).not.toContain("npm publish");
  });
});
