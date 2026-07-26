import { createHash } from "node:crypto";

import type { CalendarInfo } from "../caldav/index.js";
import type { EventResult } from "../services/index.js";

const diagnosticHref = (href: string): string => {
  try {
    const url = new URL(href);
    return `sha256:${createHash("sha256").update(url.href).digest("hex").slice(0, 16)}`;
  } catch {
    return "[invalid href]";
  }
};

export const serializeCalendar = (calendar: CalendarInfo) => ({
  calendar_id: calendar.calendarId,
  display_name: calendar.displayName,
  description: calendar.description,
  timezone: calendar.timezone,
  writable: calendar.writable,
});

export const serializeEvent = (event: EventResult) => ({
  calendar_id: event.calendarId,
  resource_id: event.resourceId,
  uid: event.uid,
  href: diagnosticHref(event.href),
  etag: event.etag,
  summary: event.summary,
  start: event.start,
  end: event.end,
  description: event.description,
  location: event.location,
  rrule: event.rrule,
  alarms: event.alarms.map((alarm) => ({
    uid: alarm.uid,
    minutes_before: alarm.minutesBefore,
    action: alarm.action,
    description: alarm.description,
  })),
  recurring: event.recurring,
  recurrence_exception: event.recurrenceException,
  recurrence_id: event.recurrenceId,
  ...(event.rawIcal === undefined ? {} : { raw_ical: event.rawIcal }),
});
