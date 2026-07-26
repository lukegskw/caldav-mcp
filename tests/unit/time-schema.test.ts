import { describe, expect, it } from "vitest";

import {
  createEventInputSchema,
  timedTemporalValueSchema,
} from "../../src/index.js";

describe("temporal schemas", () => {
  it("accepts an offset compatible with the IANA timezone", () => {
    const value = timedTemporalValueSchema.parse({
      date_time: "2026-09-06T03:00:00+02:00",
      timezone: "Europe/Berlin",
    });

    expect(value.timezone).toBe("Europe/Berlin");
  });

  it("rejects an incompatible offset", () => {
    expect(() =>
      timedTemporalValueSchema.parse({
        date_time: "2026-09-06T03:00:00+01:00",
        timezone: "Europe/Berlin",
      }),
    ).toThrow("The date_time offset does not match timezone");
  });

  it("requires an exclusive all-day end date", () => {
    expect(() =>
      createEventInputSchema.parse({
        calendar_id: "calendar",
        summary: "All day",
        start: { date: "2026-09-06" },
        end: { date: "2026-09-06" },
      }),
    ).toThrow("all-day end date must be after start date");
  });
});
