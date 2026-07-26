import { describe, expect, it } from "vitest";

import {
  createResourceId,
  isAppError,
  readResourceId,
} from "../../src/index.js";

describe("opaque resource handles", () => {
  it("accepts a child resource of the encoded calendar", () => {
    const resourceId = createResourceId(
      "https://example.test/calendars/personal",
      "https://example.test/calendars/personal/event.ics",
    );

    expect(readResourceId(resourceId).resourceUrl).toBe(
      "https://example.test/calendars/personal/event.ics",
    );
  });

  it("rejects same-prefix and cross-origin resource URLs", () => {
    const prefixCollision = createResourceId(
      "https://example.test/calendars/personal",
      "https://example.test/calendars/personal-archive/event.ics",
    );
    const crossOrigin = createResourceId(
      "https://example.test/calendars/personal/",
      "https://attacker.test/calendars/personal/event.ics",
    );

    expect(() => readResourceId(prefixCollision)).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    expect(() => readResourceId(crossOrigin)).toThrow(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    try {
      readResourceId(crossOrigin);
    } catch (cause) {
      expect(isAppError(cause)).toBe(true);
    }
  });
});
