import { z } from "zod";

import {
  createEventInputSchema,
  eventPatchSchema,
  isValidTimezone,
  temporalValueSchema,
} from "../schemas/index.js";

const instantSchema = z.iso
  .datetime({ offset: true })
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid instant");

const eventLocatorShape = {
  resource_id: z.string().min(1).optional(),
  calendar_id: z.string().min(1).optional(),
  uid: z.string().min(1).max(4_096).optional(),
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
    calendar_id: z.string().min(1),
    start: instantSchema,
    end: instantSchema,
    timezone: z
      .string()
      .refine(isValidTimezone, "Invalid IANA timezone")
      .optional(),
    limit: z.number().int().min(1).max(500).default(100),
    cursor: z.string().min(1).optional(),
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
    include_raw_ical: z.boolean().default(false),
  })
  .strict()
  .superRefine(validateEventLocator);

export const updateEventInputSchema = z
  .object({
    ...eventLocatorShape,
    expected_etag: z.string().min(1).optional(),
    patch: eventPatchSchema,
  })
  .strict()
  .superRefine(validateEventLocator);

export const deleteEventInputSchema = z
  .object({
    ...eventLocatorShape,
    expected_etag: z.string().min(1).optional(),
  })
  .strict()
  .superRefine(validateEventLocator);

export const createEventToolInputSchema = createEventInputSchema;

const normalizedAlarmOutputSchema = z
  .object({
    uid: z.string().nullable(),
    minutes_before: z.number().int().nullable(),
    action: z.string(),
    description: z.string().nullable(),
  })
  .strict();

export const eventOutputSchema = z
  .object({
    calendar_id: z.string(),
    resource_id: z.string(),
    uid: z.string(),
    href: z.string(),
    etag: z.string().nullable(),
    summary: z.string(),
    start: temporalValueSchema,
    end: temporalValueSchema,
    description: z.string().nullable(),
    location: z.string().nullable(),
    rrule: z.string().nullable(),
    alarms: z.array(normalizedAlarmOutputSchema),
    recurring: z.boolean(),
    recurrence_exception: z.boolean(),
    recurrence_id: z.string().nullable(),
    raw_ical: z.string().optional(),
  })
  .strict();

export const listCalendarsOutputSchema = z
  .object({
    calendars: z.array(
      z
        .object({
          calendar_id: z.string(),
          display_name: z.string(),
          description: z.string().nullable(),
          timezone: z.string().nullable(),
          writable: z.boolean().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const listEventsOutputSchema = z
  .object({
    events: z.array(eventOutputSchema),
    next_cursor: z.string().nullable(),
  })
  .strict();

export const deleteEventOutputSchema = z
  .object({
    deleted: z.literal(true),
    resource_id: z.string(),
  })
  .strict();

export type ListEventsInput = z.output<typeof listEventsInputSchema>;
