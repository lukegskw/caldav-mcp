import { z } from "zod";

import { alarmsInputSchema } from "./alarms.js";
import {
  isTimedTemporalValue,
  temporalValueSchema,
  type CalendarTemporalValue,
  type TemporalValue,
} from "./time.js";

const validateTemporalRange = (
  start: TemporalValue,
  end: TemporalValue,
  context: z.RefinementCtx,
): void => {
  const timedStart = isTimedTemporalValue(start);
  const timedEnd = isTimedTemporalValue(end);
  if (timedStart !== timedEnd) {
    context.addIssue({
      code: "custom",
      message: "start and end must use the same temporal type",
      path: ["end"],
    });
    return;
  }
  if (timedStart && timedEnd) {
    if (start.timezone !== end.timezone) {
      context.addIssue({
        code: "custom",
        message: "start and end must use the same timezone",
        path: ["end", "timezone"],
      });
    }
    if (Date.parse(end.date_time) <= Date.parse(start.date_time)) {
      context.addIssue({
        code: "custom",
        message: "end must be after start",
        path: ["end"],
      });
    }
    return;
  }
  if (!(timedStart || timedEnd) && end.date <= start.date) {
    context.addIssue({
      code: "custom",
      message: "all-day end date must be after start date",
      path: ["end"],
    });
  }
};

const summarySchema = z
  .string()
  .min(1)
  .max(1_024)
  .describe("Event title, between 1 and 1,024 characters.");
const descriptionSchema = z
  .string()
  .max(100_000)
  .nullable()
  .describe("Event notes, or null for no description.");
const locationSchema = z
  .string()
  .max(4_096)
  .nullable()
  .describe("Event location, or null for no location.");
const recurrenceRuleSchema = z
  .string()
  .min(1)
  .max(4_096)
  .nullable()
  .describe(
    "RFC 5545 recurrence rule without the RRULE: prefix, or null for a non-recurring event.",
  );

export const createEventInputSchema = z
  .object({
    calendar_id: z
      .string()
      .min(1)
      .describe("Opaque destination calendar ID returned by list_calendars."),
    summary: summarySchema,
    start: temporalValueSchema.describe(
      "Event start as a timed date-time or all-day date.",
    ),
    end: temporalValueSchema.describe(
      "Event end using the same temporal type and timezone as start; an all-day end date is exclusive.",
    ),
    description: descriptionSchema
      .default(null)
      .describe("Event notes; defaults to null."),
    location: locationSchema
      .default(null)
      .describe("Event location; defaults to null."),
    alarms: alarmsInputSchema
      .default([])
      .describe("Display reminders; defaults to an empty array."),
    rrule: recurrenceRuleSchema
      .default(null)
      .describe(
        "RFC 5545 recurrence rule without the RRULE: prefix; defaults to null.",
      ),
  })
  .strict()
  .superRefine((value, context) => {
    validateTemporalRange(value.start, value.end, context);
  });

export const eventPatchSchema = z
  .object({
    summary: summarySchema.optional().describe("Replacement event title."),
    start: temporalValueSchema
      .optional()
      .describe("Replacement start; provide together with end."),
    end: temporalValueSchema
      .optional()
      .describe(
        "Replacement end; provide together with start. An all-day end date is exclusive.",
      ),
    description: descriptionSchema
      .optional()
      .describe("Replacement notes; use null to clear the description."),
    location: locationSchema
      .optional()
      .describe("Replacement location; use null to clear it."),
    alarms: alarmsInputSchema
      .optional()
      .describe(
        "Replacement alarm set; use an empty array to remove all alarms.",
      ),
    rrule: recurrenceRuleSchema
      .optional()
      .describe(
        "Replacement RFC 5545 recurrence rule without RRULE:, or null to make the event non-recurring.",
      ),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.start === undefined) !== (value.end === undefined)) {
      context.addIssue({
        code: "custom",
        message: "start and end must be updated together",
        path: [value.start === undefined ? "start" : "end"],
      });
      return;
    }
    if (value.start !== undefined && value.end !== undefined) {
      validateTemporalRange(value.start, value.end, context);
    }
  });

export type CreateEventInput = z.output<typeof createEventInputSchema>;
export type EventPatch = z.output<typeof eventPatchSchema>;

export type NormalizedAlarm = {
  readonly uid: string | null;
  readonly minutesBefore: number | null;
  readonly action: string;
  readonly description: string | null;
};

export type NormalizedEvent = {
  readonly uid: string;
  readonly summary: string;
  readonly start: CalendarTemporalValue;
  readonly end: CalendarTemporalValue;
  readonly description: string | null;
  readonly location: string | null;
  readonly rrule: string | null;
  readonly alarms: readonly NormalizedAlarm[];
  readonly recurring: boolean;
  readonly recurrenceException: boolean;
  readonly recurrenceId: string | null;
};
