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

const summarySchema = z.string().min(1).max(1_024);
const descriptionSchema = z.string().max(100_000).nullable();
const locationSchema = z.string().max(4_096).nullable();
const recurrenceRuleSchema = z.string().min(1).max(4_096).nullable();

export const createEventInputSchema = z
  .object({
    calendar_id: z.string().min(1),
    summary: summarySchema,
    start: temporalValueSchema,
    end: temporalValueSchema,
    description: descriptionSchema.default(null),
    location: locationSchema.default(null),
    alarms: alarmsInputSchema.default([]),
    rrule: recurrenceRuleSchema.default(null),
  })
  .strict()
  .superRefine((value, context) => {
    validateTemporalRange(value.start, value.end, context);
  });

export const eventPatchSchema = z
  .object({
    summary: summarySchema.optional(),
    start: temporalValueSchema.optional(),
    end: temporalValueSchema.optional(),
    description: descriptionSchema.optional(),
    location: locationSchema.optional(),
    alarms: alarmsInputSchema.optional(),
    rrule: recurrenceRuleSchema.optional(),
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
