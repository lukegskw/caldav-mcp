import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { loadConfig, redactConfig } from "../../src/index.js";

const iCloudEnvironment = {
  CALDAV_USERNAME: "user@example.com",
  CALDAV_PASSWORD: "secret-value",
};

describe("loadConfig", () => {
  it("uses secure iCloud defaults", () => {
    const config = loadConfig(iCloudEnvironment);

    expect(config.provider).toBe("icloud");
    expect(config.url).toBe("https://caldav.icloud.com");
    expect(config.transport).toBe("stdio");
    expect(config.port).toBe(8100);
    expect(config.requestTimeoutMs).toBe(30_000);
  });

  it("requires a URL for the generic provider", () => {
    expect(() =>
      loadConfig({
        ...iCloudEnvironment,
        CALDAV_PROVIDER: "generic",
      }),
    ).toThrow("CALDAV_URL is required for the generic provider");
  });

  it("redacts the password", () => {
    const redacted = redactConfig(loadConfig(iCloudEnvironment));

    expect(redacted.password).toBe("[REDACTED]");
    expect(JSON.stringify(redacted)).not.toContain("secret-value");
  });

  it("redacts the password during inspection and JSON serialization", () => {
    const config = loadConfig(iCloudEnvironment);

    expect(inspect(config)).not.toContain("secret-value");
    expect(inspect(config)).toContain("[REDACTED]");
    expect(JSON.stringify(config)).not.toContain("secret-value");
    expect(JSON.stringify(config)).toContain("[REDACTED]");
  });
});
