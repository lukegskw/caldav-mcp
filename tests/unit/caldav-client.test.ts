import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tsdav = vi.hoisted(() => ({
  fetchCalendarObjects: vi.fn<() => Promise<readonly unknown[]>>(),
  fetchCalendars: vi.fn<() => Promise<readonly unknown[]>>(),
  login: vi.fn<() => Promise<void>>(),
}));

vi.mock("tsdav", () => ({
  DAVClient: class {
    readonly fetchCalendarObjects = tsdav.fetchCalendarObjects;
    readonly fetchCalendars = tsdav.fetchCalendars;
    readonly login = tsdav.login;
  },
}));

import {
  createCalDavGateway,
  createCalendarId,
  isAppError,
  type AppConfig,
  type AppError,
} from "../../src/index.js";

const config: AppConfig = {
  provider: "icloud",
  url: "https://caldav.icloud.com",
  username: "test@example.com",
  password: "app-specific-password",
  transport: "streamable-http",
  host: "127.0.0.1",
  port: 8100,
  logLevel: "INFO",
  requestTimeoutMs: 30_000,
};

const calendarUrl = "https://p01-caldav.icloud.com/123/calendars/personal/";
const calendar = {
  url: calendarUrl,
  displayName: "Personal",
};

const captureAppError = async (
  operation: Promise<unknown>,
): Promise<AppError> => {
  try {
    await operation;
  } catch (cause) {
    if (isAppError(cause)) {
      return cause;
    }
    throw cause;
  }
  throw new Error("Expected operation to fail");
};

describe("CalDAV client calendar discovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T10:00:00Z"));
    tsdav.login.mockReset().mockResolvedValue(undefined);
    tsdav.fetchCalendars.mockReset();
    tsdav.fetchCalendarObjects.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reuses a recently listed calendar for an immediate resource query", async () => {
    tsdav.fetchCalendars
      .mockResolvedValueOnce([calendar])
      .mockResolvedValueOnce([]);
    const gateway = createCalDavGateway(config);

    const calendars = await gateway.listCalendars();
    const listedCalendar = calendars[0];
    expect(listedCalendar).toBeDefined();
    if (listedCalendar === undefined) {
      throw new Error("Missing listed calendar");
    }

    await expect(
      gateway.listResources(listedCalendar.calendarId),
    ).resolves.toEqual([]);
    expect(tsdav.fetchCalendars).toHaveBeenCalledTimes(1);
    expect(tsdav.fetchCalendarObjects).toHaveBeenCalledTimes(1);
  });

  it("refreshes discovery after the snapshot TTL", async () => {
    tsdav.fetchCalendars.mockResolvedValue([calendar]);
    const gateway = createCalDavGateway(config);
    const calendars = await gateway.listCalendars();
    const listedCalendar = calendars[0];
    if (listedCalendar === undefined) {
      throw new Error("Missing listed calendar");
    }

    vi.advanceTimersByTime(5 * 60 * 1_000 + 1);
    await gateway.listResources(listedCalendar.calendarId);

    expect(tsdav.fetchCalendars).toHaveBeenCalledTimes(2);
  });

  it("shares an in-flight discovery between concurrent callers", async () => {
    let resolveDiscovery: ((calendars: readonly unknown[]) => void) | undefined;
    const discovery = new Promise<readonly unknown[]>((resolve) => {
      resolveDiscovery = resolve;
    });
    tsdav.fetchCalendars.mockReturnValueOnce(discovery);
    const gateway = createCalDavGateway(config);

    const firstListing = gateway.listCalendars();
    const secondListing = gateway.listCalendars();
    await vi.advanceTimersByTimeAsync(0);

    expect(tsdav.fetchCalendars).toHaveBeenCalledTimes(1);
    if (resolveDiscovery === undefined) {
      throw new Error("Discovery did not start");
    }
    resolveDiscovery([calendar]);
    await expect(Promise.all([firstListing, secondListing])).resolves.toEqual([
      [expect.objectContaining({ displayName: "Personal" })],
      [expect.objectContaining({ displayName: "Personal" })],
    ]);
  });

  it("marks a known calendar's first disappearance as retryable", async () => {
    tsdav.fetchCalendars
      .mockResolvedValueOnce([calendar])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const gateway = createCalDavGateway(config);
    const calendars = await gateway.listCalendars();
    const listedCalendar = calendars[0];
    if (listedCalendar === undefined) {
      throw new Error("Missing listed calendar");
    }
    vi.advanceTimersByTime(5 * 60 * 1_000 + 1);

    const firstMiss = await captureAppError(
      gateway.listResources(listedCalendar.calendarId),
    );
    expect(firstMiss).toMatchObject({
      code: "CALENDAR_NOT_FOUND",
      retryable: true,
    });

    const secondMiss = await captureAppError(
      gateway.listResources(listedCalendar.calendarId),
    );
    expect(secondMiss).toMatchObject({
      code: "CALENDAR_NOT_FOUND",
      retryable: false,
    });
  });

  it("preserves the previous snapshot when discovery fails", async () => {
    tsdav.fetchCalendars
      .mockResolvedValueOnce([calendar])
      .mockRejectedValueOnce(new Error("Temporary upstream failure"))
      .mockResolvedValueOnce([]);
    const gateway = createCalDavGateway(config);
    const calendars = await gateway.listCalendars();
    const listedCalendar = calendars[0];
    if (listedCalendar === undefined) {
      throw new Error("Missing listed calendar");
    }
    vi.advanceTimersByTime(5 * 60 * 1_000 + 1);

    const transportFailure = await captureAppError(
      gateway.listResources(listedCalendar.calendarId),
    );
    expect(transportFailure.code).toBe("CALDAV_UNAVAILABLE");

    const missingCalendar = await captureAppError(
      gateway.listResources(listedCalendar.calendarId),
    );
    expect(missingCalendar).toMatchObject({
      code: "CALENDAR_NOT_FOUND",
      retryable: true,
    });
  });

  it("matches an independently discovered URL with a trailing slash", async () => {
    tsdav.fetchCalendars.mockResolvedValueOnce([calendar]);
    const gateway = createCalDavGateway(config);

    await expect(
      gateway.listResources(createCalendarId(calendarUrl.slice(0, -1))),
    ).resolves.toEqual([]);
    expect(tsdav.fetchCalendarObjects).toHaveBeenCalledTimes(1);
  });

  it("does not query resources for an unknown calendar ID", async () => {
    tsdav.fetchCalendars.mockResolvedValueOnce([calendar]);
    const gateway = createCalDavGateway(config);

    const error = await captureAppError(
      gateway.listResources(
        createCalendarId(
          "https://p01-caldav.icloud.com/123/calendars/unknown/",
        ),
      ),
    );

    expect(error).toMatchObject({
      code: "CALENDAR_NOT_FOUND",
      retryable: false,
    });
    expect(tsdav.fetchCalendarObjects).not.toHaveBeenCalled();
  });
});
