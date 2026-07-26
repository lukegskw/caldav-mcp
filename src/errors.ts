export type ErrorCode =
  | "AUTHENTICATION_FAILED"
  | "CALDAV_UNAVAILABLE"
  | "CALENDAR_NOT_FOUND"
  | "CALENDAR_READ_ONLY"
  | "EVENT_NOT_FOUND"
  | "AMBIGUOUS_EVENT"
  | "ETAG_CONFLICT"
  | "VALIDATION_FAILED"
  | "INVALID_RRULE"
  | "INVALID_ICALENDAR"
  | "RESOURCE_TOO_LARGE"
  | "UNSUPPORTED_RECURRENCE_INSTANCE_MUTATION"
  | "PROVIDER_INCOMPATIBLE"
  | "WRITE_RESULT_UNKNOWN";

export const errorCodes: readonly ErrorCode[] = [
  "AUTHENTICATION_FAILED",
  "CALDAV_UNAVAILABLE",
  "CALENDAR_NOT_FOUND",
  "CALENDAR_READ_ONLY",
  "EVENT_NOT_FOUND",
  "AMBIGUOUS_EVENT",
  "ETAG_CONFLICT",
  "VALIDATION_FAILED",
  "INVALID_RRULE",
  "INVALID_ICALENDAR",
  "RESOURCE_TOO_LARGE",
  "UNSUPPORTED_RECURRENCE_INSTANCE_MUTATION",
  "PROVIDER_INCOMPATIBLE",
  "WRITE_RESULT_UNKNOWN",
];

export type AppError = Error & {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly cause?: unknown;
};

export type CreateAppErrorInput = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
};

export const createAppError = ({
  code,
  message,
  retryable = false,
  cause,
}: CreateAppErrorInput): AppError => {
  const error = Object.assign(
    new Error(message, cause === undefined ? undefined : { cause }),
    {
      name: "CalDavMcpError",
      code,
      retryable,
    },
  );
  return error;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const isAppError = (value: unknown): value is AppError =>
  value instanceof Error &&
  isRecord(value) &&
  typeof value["code"] === "string" &&
  errorCodes.some((code) => code === value["code"]) &&
  typeof value["retryable"] === "boolean";
