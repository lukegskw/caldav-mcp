import { z } from "zod";

import { MAX_EVENT_PAGE_SIZE } from "../limits.js";
import {
  calendarTemporalValueSchema,
  createEventInputSchema,
  eventPatchSchema,
  isValidTimezone,
} from "../schemas/index.js";

const instantSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid instant")
  .describe("ISO 8601 instant with an explicit UTC offset or Z.");

const eventLocatorShape = {
  resource_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Opaque event resource ID returned by list_events or get_event. Provide it alone instead of calendar_id and uid.",
    ),
  calendar_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Opaque calendar ID returned by list_calendars. Provide it together with uid when resource_id is unavailable.",
    ),
  uid: z
    .string()
    .min(1)
    .max(4_096)
    .optional()
    .describe(
      "iCalendar UID of the event. Provide it together with calendar_id when resource_id is unavailable.",
    ),
};

export type EventLocator = {
  readonly resource_id?: string | undefined;
  readonly calendar_id?: string | undefined;
  readonly uid?: string | undefined;
};

const validateEventLocator = (
  value: EventLocator,
  context: z.RefinementCtx,
): void => {
  const hasResource = value.resource_id !== undefined;
  const hasFallback =
    value.calendar_id !== undefined && value.uid !== undefined;
  if (hasResource === hasFallback) {
    context.addIssue({
      code: "custom",
      message:
        "Provide resource_id or the calendar_id and uid pair, but not both",
      path: ["resource_id"],
    });
  }
  if (
    !hasResource &&
    (value.calendar_id === undefined) !== (value.uid === undefined)
  ) {
    context.addIssue({
      code: "custom",
      message: "calendar_id and uid must be provided together",
      path: [value.calendar_id === undefined ? "calendar_id" : "uid"],
    });
  }
};

export const listCalendarsInputSchema = z.object({}).strict();

export const listEventsInputSchema = z
  .object({
    calendar_id: z
      .string()
      .min(1)
      .describe("Opaque calendar ID returned by list_calendars."),
    start: instantSchema.describe(
      "Inclusive start of the event search interval as an ISO 8601 instant.",
    ),
    end: instantSchema.describe(
      "Exclusive end of the event search interval; must be after start and no more than 366 days later.",
    ),
    timezone: z
      .string()
      .refine(isValidTimezone, "Invalid IANA timezone")
      .optional()
      .describe(
        "Fallback IANA timezone used when an event lacks timezone metadata during recurrence expansion.",
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_EVENT_PAGE_SIZE)
      .default(100)
      .describe(
        `Maximum events to return in this page, from 1 to ${String(MAX_EVENT_PAGE_SIZE)}; defaults to 100.`,
      ),
    cursor: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Opaque next_cursor from the preceding page. Reuse it with the same calendar, interval, and timezone.",
      ),
  })
  .strict()
  .superRefine((value, context) => {
    const start = Date.parse(value.start);
    const end = Date.parse(value.end);
    if (end <= start) {
      context.addIssue({
        code: "custom",
        message: "end must be after start",
        path: ["end"],
      });
      return;
    }
    const maximumRange = 366 * 24 * 60 * 60 * 1_000;
    if (end - start > maximumRange) {
      context.addIssue({
        code: "custom",
        message: "The requested range cannot exceed 366 days",
        path: ["end"],
      });
    }
  });

export const getEventInputSchema = z
  .object({
    ...eventLocatorShape,
    include_raw_ical: z
      .boolean()
      .default(false)
      .describe(
        "Include the raw iCalendar resource for controlled diagnostics; it may contain sensitive calendar data. Defaults to false.",
      ),
  })
  .strict()
  .superRefine(validateEventLocator);

export const updateEventInputSchema = z
  .object({
    ...eventLocatorShape,
    expected_etag: z
      .string()
      .min(1)
      .optional()
      .describe(
        "ETag previously returned for the event. When supplied, the update fails if the event changed since it was read.",
      ),
    patch: eventPatchSchema.describe(
      "Fields to replace. Omitted fields are preserved; null clears nullable values and an empty alarms array removes all alarms.",
    ),
  })
  .strict()
  .superRefine(validateEventLocator);

export const deleteEventInputSchema = z
  .object({
    ...eventLocatorShape,
    expected_etag: z
      .string()
      .min(1)
      .optional()
      .describe(
        "ETag previously returned for the event. When supplied, deletion fails if the event changed since it was read.",
      ),
  })
  .strict()
  .superRefine(validateEventLocator);

export const createEventToolInputSchema = createEventInputSchema;

const normalizedAlarmOutputSchema = z
  .object({
    uid: z.string().nullable().describe("Stored alarm UID, when available."),
    minutes_before: z
      .number()
      .int()
      .nullable()
      .describe("Whole minutes before event start, when representable."),
    action: z.string().describe("Stored iCalendar alarm action."),
    description: z
      .string()
      .nullable()
      .describe("Stored alarm notification text, when available."),
  })
  .strict()
  .describe("A normalized alarm returned by iCloud Calendar.");

export const eventOutputSchema = z
  .object({
    calendar_id: z.string().describe("Opaque ID of the containing calendar."),
    resource_id: z
      .string()
      .describe(
        "Opaque event ID accepted by get_event, update_event, and delete_event.",
      ),
    uid: z.string().describe("Stored iCalendar UID."),
    href: z
      .string()
      .describe("Redacted fingerprint of the CalDAV resource URL."),
    etag: z
      .string()
      .nullable()
      .describe("Current ETag for optimistic concurrency, when available."),
    summary: z.string().describe("Stored event title."),
    start: calendarTemporalValueSchema.describe("Normalized event start."),
    end: calendarTemporalValueSchema.describe("Normalized event end."),
    description: z.string().nullable().describe("Stored event notes."),
    location: z.string().nullable().describe("Stored event location."),
    rrule: z
      .string()
      .nullable()
      .describe("Stored RFC 5545 recurrence rule without the RRULE: prefix."),
    alarms: z
      .array(normalizedAlarmOutputSchema)
      .describe("Normalized alarms attached to the event."),
    recurring: z
      .boolean()
      .describe("Whether this event belongs to a recurring series."),
    recurrence_exception: z
      .boolean()
      .describe("Whether this result is an overridden recurrence instance."),
    recurrence_id: z
      .string()
      .nullable()
      .describe("Occurrence identifier for an expanded recurring event."),
    raw_ical: z
      .string()
      .optional()
      .describe(
        "Raw iCalendar resource, included only when explicitly requested.",
      ),
  })
  .strict();

export const listCalendarsOutputSchema = z
  .object({
    calendars: z
      .array(
        z
          .object({
            calendar_id: z
              .string()
              .describe("Opaque calendar ID used by event tools."),
            display_name: z.string().describe("Calendar display name."),
            description: z
              .string()
              .nullable()
              .describe("Calendar description."),
            timezone: z
              .string()
              .nullable()
              .describe("Calendar timezone, when advertised by the server."),
            writable: z
              .boolean()
              .nullable()
              .describe("Best-effort writable status; null means unknown."),
          })
          .strict(),
      )
      .describe("Calendars available to the configured account."),
  })
  .strict();

export const listEventsOutputSchema = z
  .object({
    events: z
      .array(eventOutputSchema)
      .describe("Events in deterministic chronological order for this page."),
    next_cursor: z
      .string()
      .nullable()
      .describe(
        "Opaque cursor for the next page, or null when this is the last page.",
      ),
  })
  .strict();

export const deleteEventOutputSchema = z
  .object({
    deleted: z
      .literal(true)
      .describe("Confirms that the resource was deleted."),
    resource_id: z
      .string()
      .describe("Opaque ID of the deleted event resource."),
  })
  .strict();

export type ListEventsInput = z.output<typeof listEventsInputSchema>;
