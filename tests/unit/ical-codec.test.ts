import { describe, expect, it } from "vitest";

import {
  createCalendarEvent,
  createEventInputSchema,
  eventPatchSchema,
  genericProviderPolicy,
  iCloudProviderPolicy,
  normalizeCalendarEvent,
  patchCalendarEvent,
} from "../../src/index.js";

const createUuidFactory = (...values: readonly string[]): (() => string) => {
  let index = 0;
  return () => {
    const value = values[index];
    if (value === undefined) {
      throw new Error("The UUID fixture is exhausted");
    }
    index += 1;
    return value;
  };
};

const eventInput = createEventInputSchema.parse({
  calendar_id: "calendar",
  summary: "Comprar passagens, ida; volta",
  start: {
    date_time: "2026-09-06T03:00:00+02:00",
    timezone: "Europe/Berlin",
  },
  end: {
    date_time: "2026-09-06T03:30:00+02:00",
    timezone: "Europe/Berlin",
  },
  description: "Linha 1\nLinha 2",
  alarms: [
    { minutes_before: 1440 },
    { minutes_before: 0, description: "Agora" },
  ],
});

describe("iCalendar codec", () => {
  it("creates and normalizes multiple standard alarms", () => {
    const calendar = createCalendarEvent({
      input: eventInput,
      provider: genericProviderPolicy,
      now: new Date("2026-01-01T00:00:00Z"),
      createUuid: createUuidFactory("event", "alarm-one", "alarm-two"),
    });

    expect(calendar).toContain("TRIGGER:-P1D");
    expect(calendar).toContain("TRIGGER:PT0S");
    expect(calendar).not.toContain("X-WR-ALARMUID");
    expect(calendar).toContain("SUMMARY:Comprar passagens\\, ida\\; volta");

    const normalized = normalizeCalendarEvent(calendar);
    expect(normalized.uid).toBe("event@caldav-mcp");
    expect(normalized.start).toEqual(eventInput.start);
    expect(normalized.end).toEqual(eventInput.end);
    expect(normalized.alarms.map((alarm) => alarm.minutesBefore)).toEqual([
      1440, 0,
    ]);
  });

  it("adds Apple alarm extensions only for iCloud", () => {
    const calendar = createCalendarEvent({
      input: eventInput,
      provider: iCloudProviderPolicy,
      createUuid: createUuidFactory("event", "alarm-one", "alarm-two"),
    });

    expect(calendar.split("X-WR-ALARMUID").length - 1).toBe(2);
    expect(calendar.split("X-APPLE-DEFAULT-ALARM").length - 1).toBe(2);
  });

  it("preserves unknown properties and alarms when they are omitted", () => {
    const calendar = createCalendarEvent({
      input: eventInput,
      provider: iCloudProviderPolicy,
      createUuid: createUuidFactory("event", "alarm-one", "alarm-two"),
    }).replace("BEGIN:VEVENT", "BEGIN:VEVENT\r\nX-CUSTOM-PROPERTY:keep-me");
    const patch = eventPatchSchema.parse({ summary: "Título atualizado" });

    const updated = patchCalendarEvent({
      rawCalendar: calendar,
      patch,
      provider: iCloudProviderPolicy,
      now: new Date("2026-01-02T00:00:00Z"),
    });

    expect(updated).toContain("X-CUSTOM-PROPERTY:keep-me");
    expect(updated.split("BEGIN:VALARM").length - 1).toBe(2);
    expect(normalizeCalendarEvent(updated).summary).toBe("Título atualizado");
  });

  it("removes alarms only when an empty list is explicit", () => {
    const calendar = createCalendarEvent({
      input: eventInput,
      provider: iCloudProviderPolicy,
      createUuid: createUuidFactory("event", "alarm-one", "alarm-two"),
    });

    const updated = patchCalendarEvent({
      rawCalendar: calendar,
      patch: eventPatchSchema.parse({ alarms: [] }),
      provider: iCloudProviderPolicy,
    });

    expect(updated).not.toContain("BEGIN:VALARM");
    expect(normalizeCalendarEvent(updated).alarms).toEqual([]);
  });
});
