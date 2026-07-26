import { z } from "zod";

import { createAppError } from "../errors.js";

const calendarHandleSchema = z
  .object({
    version: z.literal(1),
    calendarUrl: z.url(),
  })
  .strict();

const resourceHandleSchema = z
  .object({
    version: z.literal(1),
    calendarUrl: z.url(),
    resourceUrl: z.url(),
    recurrenceId: z.string().min(1).optional(),
  })
  .strict();

export type CalendarHandle = z.output<typeof calendarHandleSchema>;
export type ResourceHandle = z.output<typeof resourceHandleSchema>;

const encodeHandle = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const decodeJson = (token: string): unknown => {
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch (cause) {
    throw createAppError({
      code: "VALIDATION_FAILED",
      message: "The opaque resource identifier is invalid",
      cause,
    });
  }
};

export const createCalendarId = (calendarUrl: string): string =>
  encodeHandle({ version: 1, calendarUrl });

export const readCalendarId = (calendarId: string): CalendarHandle => {
  const result = calendarHandleSchema.safeParse(decodeJson(calendarId));
  if (!result.success) {
    throw createAppError({
      code: "VALIDATION_FAILED",
      message: "The calendar identifier is invalid",
      cause: result.error,
    });
  }
  return result.data;
};

export const createResourceId = (
  calendarUrl: string,
  resourceUrl: string,
  recurrenceId?: string,
): string =>
  encodeHandle({
    version: 1,
    calendarUrl,
    resourceUrl,
    ...(recurrenceId === undefined ? {} : { recurrenceId }),
  });

export const readResourceId = (resourceId: string): ResourceHandle => {
  const result = resourceHandleSchema.safeParse(decodeJson(resourceId));
  if (!result.success) {
    throw createAppError({
      code: "VALIDATION_FAILED",
      message: "The event resource identifier is invalid",
      cause: result.error,
    });
  }
  const calendar = new URL(result.data.calendarUrl);
  const resource = new URL(result.data.resourceUrl);
  const calendarPath = calendar.pathname.endsWith("/")
    ? calendar.pathname
    : `${calendar.pathname}/`;
  if (
    calendar.origin !== resource.origin ||
    !resource.pathname.startsWith(calendarPath)
  ) {
    throw createAppError({
      code: "VALIDATION_FAILED",
      message: "The event resource does not belong to the calendar",
    });
  }
  return result.data;
};
