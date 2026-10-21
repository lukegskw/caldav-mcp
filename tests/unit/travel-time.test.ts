import { describe, expect, it } from "vitest";

import {
  createCalendarEvent,
  createEventInputSchema,
  eventPatchSchema,
  expandCalendarEvent,
  iCloudProviderPolicy,
  normalizeCalendarEvent,
  patchCalendarEvent,
} from "../../src/index.js";

const timedEvent = {
  calendar_id: "calendar",
  summary: "Tandarts",
  start: {
    date_time: "2026-10-05T10:00:00+02:00",
    timezone: "Europe/Amsterdam",
  },
  end: {
    date_time: "2026-10-05T10:30:00+02:00",
    timezone: "Europe/Amsterdam",
  },
};

const allDayEvent = {
  calendar_id: "calendar",
  summary: "Vrije dag",
  start: { date: "2026-10-05" },
  end: { date: "2026-10-06" },
};

const createRaw = (input: Record<string, unknown>): string =>
  createCalendarEvent({
    input: createEventInputSchema.parse(input),
    provider: iCloudProviderPolicy,
    now: new Date("2026-01-01T00:00:00Z"),
    createUuid: () => "event",
  });

const accepts = (input: Record<string, unknown>): boolean =>
  createEventInputSchema.safeParse(input).success;

const patchAccepts = (patch: Record<string, unknown>): boolean =>
  eventPatchSchema.safeParse(patch).success;

// Representative Apple extension metadata; no live Calendar account required.
const appleRaw = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Apple Inc.//macOS 26.0//EN",
  "BEGIN:VEVENT",
  "UID:apple-event",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;TZID=Europe/Amsterdam:20261005T100000",
  "DTEND;TZID=Europe/Amsterdam:20261005T103000",
  "SUMMARY:Tandarts",
  "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
  "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT1H30M",
  "X-APPLE-TRAVEL-START;ROUTING=CAR;VALUE=URI;X-TITLE=Home:",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

describe("Apple travel time", () => {
  it("writes travel time as an Apple duration property", () => {
    const raw = createRaw({ ...timedEvent, travel_minutes: 45 });

    expect(raw).toContain("X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT45M");
    expect(normalizeCalendarEvent(raw).travelMinutes).toBe(45);
  });

  it("omits travel time by default", () => {
    const raw = createRaw(timedEvent);

    expect(raw).not.toContain("X-APPLE-TRAVEL");
    expect(normalizeCalendarEvent(raw).travelMinutes).toBeNull();
  });

  it("reads travel time written by Apple Calendar", () => {
    expect(normalizeCalendarEvent(appleRaw).travelMinutes).toBe(90);
  });

  it("reads a travel duration stored without a VALUE parameter", () => {
    const raw = appleRaw.replace(
      "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT1H30M",
      "X-APPLE-TRAVEL-DURATION:PT20M",
    );

    expect(normalizeCalendarEvent(raw).travelMinutes).toBe(20);
  });

  it("preserves travel time when a patch omits it", () => {
    const updated = patchCalendarEvent({
      rawCalendar: appleRaw,
      patch: eventPatchSchema.parse({ summary: "Tandarts (controle)" }),
      provider: iCloudProviderPolicy,
    });

    expect(normalizeCalendarEvent(updated).travelMinutes).toBe(90);
    expect(updated).toContain("X-APPLE-TRAVEL-START");
  });

  it("replaces only the travel duration when a new value is set", () => {
    const updated = patchCalendarEvent({
      rawCalendar: appleRaw,
      patch: eventPatchSchema.parse({ travel_minutes: 15 }),
      provider: iCloudProviderPolicy,
    });

    expect(updated.split("X-APPLE-TRAVEL-DURATION").length - 1).toBe(1);
    expect(normalizeCalendarEvent(updated).travelMinutes).toBe(15);
    expect(updated).toContain("X-APPLE-TRAVEL-START");
  });

  it("removes all Apple travel metadata when cleared with null", () => {
    const raw = appleRaw.replace(
      "END:VEVENT",
      [
        "X-APPLE-TRAVEL-RETURN-DURATION;VALUE=DURATION:PT30M",
        "X-APPLE-TRAVEL-RETURN-START;VALUE=URI:geo:52.0,4.0",
        "X-APPLE-STRUCTURED-LOCATION;VALUE=URI:geo:52.1,4.1",
        "X-CUSTOM-PROPERTY:keep me",
        "END:VEVENT",
      ].join("\r\n"),
    );
    const updated = patchCalendarEvent({
      rawCalendar: raw,
      patch: eventPatchSchema.parse({ travel_minutes: null }),
      provider: iCloudProviderPolicy,
    });

    expect(updated).not.toContain("X-APPLE-TRAVEL");
    expect(normalizeCalendarEvent(updated).travelMinutes).toBeNull();
    expect(normalizeCalendarEvent(updated).summary).toBe("Tandarts");
    expect(updated).toContain(
      "X-APPLE-STRUCTURED-LOCATION;VALUE=URI:geo:52.1,4.1",
    );
    expect(updated).toContain("X-CUSTOM-PROPERTY:keep me");
  });

  it("carries travel time onto recurring occurrences", () => {
    const raw = createRaw({
      ...timedEvent,
      travel_minutes: 30,
      rrule: "FREQ=WEEKLY;COUNT=3",
    });

    const occurrences = expandCalendarEvent(
      raw,
      "2026-10-01T00:00:00Z",
      "2026-11-01T00:00:00Z",
    );

    expect(occurrences).toHaveLength(3);
    expect(occurrences.map((event) => event.travelMinutes)).toEqual([
      30, 30, 30,
    ]);
  });

  it("validates the travel time range", () => {
    expect(accepts({ ...timedEvent, travel_minutes: 0 })).toBe(false);
    expect(accepts({ ...timedEvent, travel_minutes: 1441 })).toBe(false);
    expect(accepts({ ...timedEvent, travel_minutes: 7.5 })).toBe(false);
    expect(accepts({ ...timedEvent, travel_minutes: 1440 })).toBe(true);
  });

  it("rejects travel time on all-day events", () => {
    const allDayPatch = {
      start: allDayEvent.start,
      end: allDayEvent.end,
      travel_minutes: 30,
    };
    const allDayRaw = createRaw(allDayEvent);
    const patchAllDay = (): string =>
      patchCalendarEvent({
        rawCalendar: allDayRaw,
        patch: eventPatchSchema.parse({ travel_minutes: 30 }),
        provider: iCloudProviderPolicy,
      });

    expect(accepts({ ...allDayEvent, travel_minutes: 30 })).toBe(false);
    expect(patchAccepts(allDayPatch)).toBe(false);
    expect(patchAllDay).toThrow("travel_minutes requires a timed event");
  });

  it.each([
    { property: ";VALUE=DURATION:garbage", expected: null },
    { property: ":garbage", expected: null },
    { property: ";VALUE=DURATION:PTXM", expected: null },
    { property: ";VALUE=DURATION:PT0S", expected: null },
    { property: ";VALUE=DURATION:-PT30M", expected: null },
    { property: ";VALUE=DURATION:P999999999999999W", expected: null },
    { property: ";VALUE=INTEGER:30", expected: null },
    { property: ";VALUE=DURATION:PT29S", expected: null },
    { property: ";VALUE=DURATION:PT30S", expected: 1 },
    { property: ":PT1M30S", expected: 2 },
    { property: ";VALUE=DURATION:P2D", expected: 2880 },
  ])(
    "normalizes travel duration $property to $expected",
    ({ property, expected }) => {
      const raw = appleRaw.replace(
        "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT1H30M",
        `X-APPLE-TRAVEL-DURATION${property}`,
      );

      expect(normalizeCalendarEvent(raw).travelMinutes).toBe(expected);
    },
  );

  it.each([1, 60, 90, 1440])("round-trips %i minutes", (minutes) => {
    expect(
      normalizeCalendarEvent(
        createRaw({ ...timedEvent, travel_minutes: minutes }),
      ).travelMinutes,
    ).toBe(minutes);
  });

  it.each([0, -1, 1441, 7.5, "30"])(
    "rejects invalid patch duration %s",
    (minutes) => {
      expect(patchAccepts({ travel_minutes: minutes })).toBe(false);
    },
  );

  it("replaces duplicate duration properties", () => {
    const raw = appleRaw.replace(
      "END:VEVENT",
      "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT5M\r\nEND:VEVENT",
    );
    const updated = patchCalendarEvent({
      rawCalendar: raw,
      patch: eventPatchSchema.parse({ travel_minutes: 15 }),
      provider: iCloudProviderPolicy,
    });

    expect(updated.match(/X-APPLE-TRAVEL-DURATION/g)).toHaveLength(1);
    expect(normalizeCalendarEvent(updated).travelMinutes).toBe(15);
  });

  it.each([
    { property: "", expected: null },
    { property: "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT0S", expected: null },
    { property: "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT15M", expected: 15 },
    {
      property: "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:garbage",
      expected: null,
    },
  ])(
    "uses the exception's travel setting: $property",
    ({ property, expected }) => {
      const raw = createRaw({
        ...timedEvent,
        travel_minutes: 30,
        rrule: "FREQ=DAILY;COUNT=3",
      }).replace(
        "END:VCALENDAR",
        [
          "BEGIN:VEVENT",
          "UID:event@caldav-mcp",
          "DTSTAMP:20260101T000000Z",
          "RECURRENCE-ID;TZID=Europe/Amsterdam:20261006T100000",
          "DTSTART;TZID=Europe/Amsterdam:20261006T100000",
          "DTEND;TZID=Europe/Amsterdam:20261006T103000",
          ...(property === "" ? [] : [property]),
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
      );

      const occurrences = expandCalendarEvent(
        raw,
        "2026-10-01T00:00:00Z",
        "2026-10-10T00:00:00Z",
      );

      expect(occurrences.map((event) => event.travelMinutes)).toEqual([
        30,
        expected,
        30,
      ]);
      expect(occurrences[1]?.recurrenceException).toBe(true);

      const cleared = patchCalendarEvent({
        rawCalendar: raw,
        patch: eventPatchSchema.parse({ travel_minutes: null }),
        provider: iCloudProviderPolicy,
      });
      expect(
        expandCalendarEvent(
          cleared,
          "2026-10-01T00:00:00Z",
          "2026-10-10T00:00:00Z",
        ).map((event) => event.travelMinutes),
      ).toEqual([null, expected, null]);
    },
  );

  it("requires explicit clearing when converting a travel event to all-day", () => {
    expect(() =>
      patchCalendarEvent({
        rawCalendar: appleRaw,
        patch: eventPatchSchema.parse({
          start: allDayEvent.start,
          end: allDayEvent.end,
        }),
        provider: iCloudProviderPolicy,
      }),
    ).toThrow("Set travel_minutes to null");

    const updated = patchCalendarEvent({
      rawCalendar: appleRaw,
      patch: eventPatchSchema.parse({
        start: allDayEvent.start,
        end: allDayEvent.end,
        travel_minutes: null,
      }),
      provider: iCloudProviderPolicy,
    });
    expect(normalizeCalendarEvent(updated)).toMatchObject({
      start: allDayEvent.start,
      end: allDayEvent.end,
      travelMinutes: null,
    });
    expect(updated).not.toContain("X-APPLE-TRAVEL-");
  });

  it("converts an event without travel time to all-day without extra fields", () => {
    const updated = patchCalendarEvent({
      rawCalendar: createRaw(timedEvent),
      patch: eventPatchSchema.parse({
        start: allDayEvent.start,
        end: allDayEvent.end,
      }),
      provider: iCloudProviderPolicy,
    });
    expect(normalizeCalendarEvent(updated).start).toEqual(allDayEvent.start);
  });

  it("allows travel time while converting an all-day event to timed", () => {
    const updated = patchCalendarEvent({
      rawCalendar: createRaw(allDayEvent),
      patch: eventPatchSchema.parse({
        start: timedEvent.start,
        end: timedEvent.end,
        travel_minutes: 30,
      }),
      provider: iCloudProviderPolicy,
    });
    expect(normalizeCalendarEvent(updated)).toMatchObject({
      start: timedEvent.start,
      travelMinutes: 30,
    });
  });

  it("allows null travel time on all-day events and clears existing metadata", () => {
    const raw = createRaw({ ...allDayEvent, travel_minutes: null }).replace(
      "END:VEVENT",
      "X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT30M\r\nEND:VEVENT",
    );
    const updated = patchCalendarEvent({
      rawCalendar: raw,
      patch: eventPatchSchema.parse({ travel_minutes: null }),
      provider: iCloudProviderPolicy,
    });
    expect(normalizeCalendarEvent(updated).travelMinutes).toBeNull();
    expect(updated).not.toContain("X-APPLE-TRAVEL-");
  });
});
