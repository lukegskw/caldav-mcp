import { describe, expect, it } from "vitest";

import {
  createCalendarEvent,
  createEventInputSchema,
  expandCalendarEvent,
  genericProviderPolicy,
} from "../../src/index.js";

describe("recurrence expansion", () => {
  it("expands a recurring event inside the requested range", () => {
    const input = createEventInputSchema.parse({
      calendar_id: "calendar",
      summary: "Daily event",
      start: {
        date_time: "2026-09-06T03:00:00+02:00",
        timezone: "Europe/Berlin",
      },
      end: {
        date_time: "2026-09-06T03:30:00+02:00",
        timezone: "Europe/Berlin",
      },
      rrule: "FREQ=DAILY;COUNT=3",
    });
    const calendar = createCalendarEvent({
      input,
      provider: genericProviderPolicy,
      createUuid: () => "event",
    });

    const occurrences = expandCalendarEvent(
      calendar,
      "2026-09-06T00:00:00Z",
      "2026-09-10T00:00:00Z",
    );

    expect(occurrences).toHaveLength(3);
    expect(occurrences.map((event) => event.recurrenceId)).toEqual([
      "2026-09-06T03:00:00",
      "2026-09-07T03:00:00",
      "2026-09-08T03:00:00",
    ]);
  });

  it("uses the requested timezone for floating recurrence times", () => {
    const calendar = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:floating",
      "DTSTAMP:20260101T000000Z",
      "DTSTART:20260906T003000",
      "DTEND:20260906T010000",
      "SUMMARY:Floating",
      "RRULE:FREQ=DAILY;COUNT=2",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    const occurrences = expandCalendarEvent(
      calendar,
      "2026-09-05T22:00:00Z",
      "2026-09-05T23:00:00Z",
      500,
      "Europe/Berlin",
    );

    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.start).toEqual({
      date_time: "2026-09-06T00:30:00+02:00",
      timezone: "Europe/Berlin",
    });
  });
});
