import { createHash } from "node:crypto";

import { z } from "zod";

import { createAppError } from "../errors.js";
import { isTimedTemporalValue } from "../schemas/index.js";
import type { EventResult } from "../services/index.js";
import type { ListEventsInput } from "./schemas.js";

const CURSOR_VERSION = 2;

const eventKeySchema = z
  .object({
    start: z.number().int(),
    startKind: z.union([z.literal(0), z.literal(1)]),
    end: z.number().int(),
    uid: z.string(),
    recurrenceId: z.string().nullable(),
    resourceId: z.string(),
  })
  .strict();

type EventKey = z.output<typeof eventKeySchema>;

const cursorSchema = z
  .object({
    version: z.literal(CURSOR_VERSION),
    lastKey: eventKeySchema,
    queryHash: z.string().length(64),
  })
  .strict();

const queryHash = (input: ListEventsInput): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        calendarId: input.calendar_id,
        start: input.start,
        end: input.end,
        timezone: input.timezone ?? null,
      }),
    )
    .digest("hex");

const temporalMilliseconds = (
  event: EventResult,
  boundary: "start" | "end",
): number => {
  const value = event[boundary];
  return Date.parse(
    isTimedTemporalValue(value) ? value.date_time : `${value.date}T00:00:00Z`,
  );
};

const eventKey = (event: EventResult): EventKey => ({
  start: temporalMilliseconds(event, "start"),
  startKind: isTimedTemporalValue(event.start) ? 1 : 0,
  end: temporalMilliseconds(event, "end"),
  uid: event.uid,
  recurrenceId: event.recurrenceId,
  resourceId: event.resourceId,
});

const compareNumber = (left: number, right: number): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareString = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareNullableString = (
  left: string | null,
  right: string | null,
): number => {
  if (left === null) {
    return right === null ? 0 : -1;
  }
  return right === null ? 1 : compareString(left, right);
};

const compareEventKeys = (left: EventKey, right: EventKey): number =>
  compareNumber(left.start, right.start) ||
  compareNumber(left.startKind, right.startKind) ||
  compareNumber(left.end, right.end) ||
  compareString(left.uid, right.uid) ||
  compareNullableString(left.recurrenceId, right.recurrenceId) ||
  compareString(left.resourceId, right.resourceId);

const createCursor = (input: ListEventsInput, lastKey: EventKey): string =>
  Buffer.from(
    JSON.stringify({
      version: CURSOR_VERSION,
      lastKey,
      queryHash: queryHash(input),
    }),
    "utf8",
  ).toString("base64url");

const readCursor = (input: ListEventsInput): EventKey | null => {
  if (input.cursor === undefined) {
    return null;
  }
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(input.cursor, "base64url").toString("utf8"),
    );
    const result = cursorSchema.safeParse(decoded);
    if (!result.success) {
      throw createAppError({
        code: "VALIDATION_FAILED",
        message: "The pagination cursor is invalid",
      });
    }
    if (result.data.queryHash !== queryHash(input)) {
      throw createAppError({
        code: "VALIDATION_FAILED",
        message: "The pagination cursor does not match this query",
      });
    }
    return result.data.lastKey;
  } catch (cause) {
    if (cause instanceof Error && cause.name === "CalDavMcpError") {
      throw cause;
    }
    throw createAppError({
      code: "VALIDATION_FAILED",
      message: "The pagination cursor is invalid",
      cause,
    });
  }
};

type PaginatedEvents = {
  readonly events: readonly EventResult[];
  readonly nextCursor: string | null;
};

export const paginateEvents = (
  input: ListEventsInput,
  events: readonly EventResult[],
): PaginatedEvents => {
  const lastKey = readCursor(input);
  const ordered = events
    .map((event) => ({ event, key: eventKey(event) }))
    .sort((left, right) => compareEventKeys(left.key, right.key));
  const remaining =
    lastKey === null
      ? ordered
      : ordered.filter(({ key }) => compareEventKeys(key, lastKey) > 0);
  const page = remaining.slice(0, input.limit);
  const final = page.at(-1);

  return {
    events: page.map(({ event }) => event),
    nextCursor:
      final !== undefined && page.length < remaining.length
        ? createCursor(input, final.key)
        : null,
  };
};
