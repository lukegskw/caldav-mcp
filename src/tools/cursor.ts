import { createHash } from "node:crypto";

import { z } from "zod";

import { createAppError } from "../errors.js";
import type { ListEventsInput } from "./schemas.js";

const cursorSchema = z
  .object({
    version: z.literal(1),
    offset: z.number().int().nonnegative(),
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

export const createCursor = (input: ListEventsInput, offset: number): string =>
  Buffer.from(
    JSON.stringify({ version: 1, offset, queryHash: queryHash(input) }),
    "utf8",
  ).toString("base64url");

export const readCursor = (input: ListEventsInput): number => {
  if (input.cursor === undefined) {
    return 0;
  }
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(input.cursor, "base64url").toString("utf8"),
    );
    const result = cursorSchema.safeParse(decoded);
    if (!result.success || result.data.queryHash !== queryHash(input)) {
      throw createAppError({
        code: "VALIDATION_FAILED",
        message: "The pagination cursor does not match this query",
      });
    }
    return result.data.offset;
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
