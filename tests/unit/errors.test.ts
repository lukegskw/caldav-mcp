import { describe, expect, it } from "vitest";

import { createAppError, isAppError } from "../../src/index.js";

describe("application errors", () => {
  it("creates a typed retryable error", () => {
    const error = createAppError({
      code: "CALDAV_UNAVAILABLE",
      message: "The CalDAV server is unavailable",
      retryable: true,
    });

    expect(isAppError(error)).toBe(true);
    expect(error.code).toBe("CALDAV_UNAVAILABLE");
    expect(error.retryable).toBe(true);
  });

  it("rejects ordinary errors", () => {
    expect(isAppError(new Error("ordinary"))).toBe(false);
  });
});
