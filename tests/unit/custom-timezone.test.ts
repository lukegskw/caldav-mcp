import { describe, expect, it } from "vitest";

import {
  calendarTemporalValueSchema,
  eventPatchSchema,
  expandCalendarEvent,
  genericProviderPolicy,
  isAppError,
  normalizeCalendarEvent,
  patchCalendarEvent,
  timedTemporalValueSchema,
} from "../../src/index.js";

const calendar = (
  timezones: readonly string[],
  eventLines: readonly string[],
): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//caldav-mcp tests//EN",
    ...timezones,
    "BEGIN:VEVENT",
    "UID:custom-timezone-test",
    "DTSTAMP:20260101T000000Z",
    ...eventLines,
    "SUMMARY:Custom timezone",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

const fixedTimezone = (tzid: string, offset: string): string =>
  [
    "BEGIN:VTIMEZONE",
    `TZID:${tzid}`,
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    `TZOFFSETFROM:${offset}`,
    `TZOFFSETTO:${offset}`,
    "TZNAME:Fixed",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");

const northernTimezone = (tzid: string): string =>
  [
    "BEGIN:VTIMEZONE",
    `TZID:${tzid}`,
    "BEGIN:DAYLIGHT",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:Custom Daylight",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:Custom Standard",
    "END:STANDARD",
    "END:VTIMEZONE",
  ].join("\r\n");

const southernTimezone = (tzid: string): string =>
  [
    "BEGIN:VTIMEZONE",
    `TZID:${tzid}`,
    "BEGIN:STANDARD",
    "DTSTART:19700405T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
    "TZOFFSETFROM:+1100",
    "TZOFFSETTO:+1000",
    "TZNAME:Custom Standard",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:19701004T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU",
    "TZOFFSETFROM:+1000",
    "TZOFFSETTO:+1100",
    "TZNAME:Custom Daylight",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n");

const timedEvent = (
  tzid: string,
  start = "20260110T100000",
  end = "20260110T110000",
): readonly string[] => [
  `DTSTART;TZID="${tzid}":${start}`,
  `DTEND;TZID="${tzid}":${end}`,
];

const expectInvalidTimezone = (rawCalendar: string): void => {
  expect(() => normalizeCalendarEvent(rawCalendar)).toThrow(
    expect.objectContaining({ code: "INVALID_ICALENDAR" }),
  );
  try {
    normalizeCalendarEvent(rawCalendar);
  } catch (error) {
    expect(isAppError(error)).toBe(true);
    expect(error).not.toBeInstanceOf(RangeError);
  }
};

describe("custom VTIMEZONE support", () => {
  it.each([
    ["GMT+0100", "+0100", "+01:00"],
    ["GMT-0330", "-0330", "-03:30"],
    ["Custom/Nepal", "+0545", "+05:45"],
    ["/example.org/Custom-Time", "+0900", "+09:00"],
  ])("resolves and preserves %s", (tzid, rawOffset, isoOffset) => {
    const event = normalizeCalendarEvent(
      calendar([fixedTimezone(tzid, rawOffset)], timedEvent(tzid)),
    );

    expect(event.start).toEqual({
      date_time: `2026-01-10T10:00:00${isoOffset}`,
      timezone: tzid,
    });
    expect(event.end).toEqual({
      date_time: `2026-01-10T11:00:00${isoOffset}`,
      timezone: tzid,
    });
  });

  it("uses an embedded definition before a runtime timezone with the same ID", () => {
    const event = normalizeCalendarEvent(
      calendar([fixedTimezone("UTC", "+0900")], timedEvent("UTC")),
    );

    expect(event.start).toEqual({
      date_time: "2026-01-10T10:00:00+09:00",
      timezone: "UTC",
    });
  });

  it("ignores an unrelated historic sub-minute offset for a modern event", () => {
    const timezone = [
      "BEGIN:VTIMEZONE",
      "TZID:Historic/Zone",
      "BEGIN:STANDARD",
      "DTSTART:18930401T000000",
      "TZOFFSETFROM:+005328",
      "TZOFFSETTO:+0100",
      "END:STANDARD",
      "BEGIN:STANDARD",
      "DTSTART:19800101T000000",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0100",
      "END:STANDARD",
      "END:VTIMEZONE",
    ].join("\r\n");

    const event = normalizeCalendarEvent(
      calendar(
        [timezone],
        timedEvent("Historic/Zone", "20350104T100000", "20350104T110000"),
      ),
    );

    expect(event.start).toEqual({
      date_time: "2035-01-04T10:00:00+01:00",
      timezone: "Historic/Zone",
    });
  });

  it("keeps same-named timezone definitions isolated between resources", () => {
    const first = normalizeCalendarEvent(
      calendar(
        [fixedTimezone("Shared/Local", "+0100")],
        timedEvent("Shared/Local"),
      ),
    );
    const second = normalizeCalendarEvent(
      calendar(
        [fixedTimezone("Shared/Local", "+0200")],
        timedEvent("Shared/Local"),
      ),
    );

    expect("date_time" in first.start && first.start.date_time).toContain(
      "+01:00",
    );
    expect("date_time" in second.start && second.start.date_time).toContain(
      "+02:00",
    );
  });

  it("resolves start and end with different custom timezones", () => {
    const event = normalizeCalendarEvent(
      calendar(
        [fixedTimezone("Zone/A", "+0100"), fixedTimezone("Zone/B", "+0300")],
        [
          'DTSTART;TZID="Zone/A":20260110T100000',
          'DTEND;TZID="Zone/B":20260110T130000',
        ],
      ),
    );

    expect(event.start).toEqual({
      date_time: "2026-01-10T10:00:00+01:00",
      timezone: "Zone/A",
    });
    expect(event.end).toEqual({
      date_time: "2026-01-10T13:00:00+03:00",
      timezone: "Zone/B",
    });
  });

  it.each([
    [
      "W. Europe Standard Time",
      northernTimezone("W. Europe Standard Time"),
      "20260110T100000",
      "+01:00",
    ],
    [
      "W. Europe Standard Time",
      northernTimezone("W. Europe Standard Time"),
      "20260610T100000",
      "+02:00",
    ],
    [
      "Custom/Southern",
      southernTimezone("Custom/Southern"),
      "20260110T100000",
      "+11:00",
    ],
    [
      "Custom/Southern",
      southernTimezone("Custom/Southern"),
      "20260610T100000",
      "+10:00",
    ],
  ])(
    "applies the embedded transition rules for %s at %s",
    (tzid, timezone, start, offset) => {
      const event = normalizeCalendarEvent(
        calendar(
          [timezone],
          timedEvent(tzid, start, start.replace("100000", "110000")),
        ),
      );

      expect(event.start).toEqual({
        date_time: `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T10:00:00${offset}`,
        timezone: tzid,
      });
    },
  );

  it("recalculates the offset for every recurring occurrence", () => {
    const tzid = "W. Europe Standard Time";
    const rawCalendar = calendar(
      [northernTimezone(tzid)],
      [
        ...timedEvent(tzid, "20260322T100000", "20260322T110000"),
        "RRULE:FREQ=WEEKLY;COUNT=3",
      ],
    );

    const events = expandCalendarEvent(
      rawCalendar,
      "2026-03-20T00:00:00Z",
      "2026-04-10T00:00:00Z",
    );

    expect(
      events.map((event) =>
        "date_time" in event.start ? event.start.date_time.slice(-6) : null,
      ),
    ).toEqual(["+01:00", "+02:00", "+02:00"]);
  });

  it("accepts custom TZIDs in outputs but keeps write inputs IANA-only", () => {
    const value = {
      date_time: "2026-01-10T10:00:00+01:00",
      timezone: "W. Europe Standard Time",
    };

    expect(calendarTemporalValueSchema.safeParse(value).success).toBe(true);
    expect(timedTemporalValueSchema.safeParse(value).success).toBe(false);
  });

  it("preserves VTIMEZONE when a patch does not replace temporal fields", () => {
    const tzid = "W. Europe Standard Time";
    const rawCalendar = calendar(
      [northernTimezone(tzid)],
      timedEvent(tzid, "20260610T100000", "20260610T110000"),
    );

    const updated = patchCalendarEvent({
      rawCalendar,
      patch: eventPatchSchema.parse({ summary: "Updated" }),
      provider: genericProviderPolicy,
      now: new Date("2026-01-02T00:00:00Z"),
    });

    expect(updated).toContain("BEGIN:VTIMEZONE");
    expect(updated).toContain(`TZID:${tzid}`);
    expect(normalizeCalendarEvent(updated).start).toEqual({
      date_time: "2026-06-10T10:00:00+02:00",
      timezone: tzid,
    });
  });

  it("rejects an unknown TZID without an embedded definition", () => {
    expectInvalidTimezone(calendar([], timedEvent("Missing/Zone")));
  });

  it("rejects an incomplete embedded definition", () => {
    const incomplete = [
      "BEGIN:VTIMEZONE",
      "TZID:Incomplete/Zone",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0100",
      "END:STANDARD",
      "END:VTIMEZONE",
    ].join("\r\n");

    expectInvalidTimezone(
      calendar([incomplete], timedEvent("Incomplete/Zone")),
    );
  });

  it("rejects conflicting definitions for the same TZID", () => {
    expectInvalidTimezone(
      calendar(
        [
          fixedTimezone("Conflicting/Zone", "+0100"),
          fixedTimezone("Conflicting/Zone", "+0200"),
        ],
        timedEvent("Conflicting/Zone"),
      ),
    );
  });

  it("rejects a sub-minute offset instead of rounding it", () => {
    expectInvalidTimezone(
      calendar(
        [fixedTimezone("Seconds/Zone", "+010030")],
        timedEvent("Seconds/Zone"),
      ),
    );
  });
});
