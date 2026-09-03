import { z } from "zod";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

const isValidCalendarDate = (value: string): boolean => {
  const parts = value.split("-");
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }

  const candidate = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  return candidate.toISOString().slice(0, 10) === value;
};

export const isValidTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

const formatInstantInTimezone = (
  instant: Date,
  timezone: string,
): string | null => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
};

export const isDateTimeCompatibleWithTimezone = (
  dateTime: string,
  timezone: string,
): boolean => {
  const instant = new Date(dateTime);
  if (Number.isNaN(instant.getTime()) || !isValidTimezone(timezone)) {
    return false;
  }
  return formatInstantInTimezone(instant, timezone) === dateTime.slice(0, 19);
};

export const calendarDateSchema = z
  .string()
  .regex(datePattern, "Expected a calendar date in YYYY-MM-DD format")
  .refine(isValidCalendarDate, "Invalid calendar date");

export const timedTemporalValueSchema = z
  .object({
    date_time: z
      .string()
      .regex(
        dateTimePattern,
        "Expected ISO 8601 with seconds and an explicit offset or Z",
      ),
    timezone: z.string().refine(isValidTimezone, "Invalid IANA timezone"),
  })
  .strict()
  .refine(
    ({ date_time: dateTime, timezone }) =>
      isDateTimeCompatibleWithTimezone(dateTime, timezone),
    "The date_time offset does not match timezone",
  );

export const allDayTemporalValueSchema = z
  .object({
    date: calendarDateSchema,
  })
  .strict();

export const temporalValueSchema = z.union([
  timedTemporalValueSchema,
  allDayTemporalValueSchema,
]);

export const calendarTimedTemporalValueSchema = z
  .object({
    date_time: z
      .string()
      .regex(
        dateTimePattern,
        "Expected ISO 8601 with seconds and an explicit offset or Z",
      )
      .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid instant"),
    timezone: z.string().min(1).max(4_096),
  })
  .strict();

export const calendarTemporalValueSchema = z.union([
  calendarTimedTemporalValueSchema,
  allDayTemporalValueSchema,
]);

export type TimedTemporalValue = z.output<typeof timedTemporalValueSchema>;
export type AllDayTemporalValue = z.output<typeof allDayTemporalValueSchema>;
export type TemporalValue = z.output<typeof temporalValueSchema>;
export type CalendarTimedTemporalValue = z.output<
  typeof calendarTimedTemporalValueSchema
>;
export type CalendarTemporalValue = z.output<
  typeof calendarTemporalValueSchema
>;

export const isTimedTemporalValue = (
  value: TemporalValue | CalendarTemporalValue,
): value is TimedTemporalValue | CalendarTimedTemporalValue =>
  "date_time" in value;
