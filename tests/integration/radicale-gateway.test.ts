import { describe, expect, it } from "vitest";

import {
  createCalDavGateway,
  createCalendarService,
  createEventInputSchema,
  eventPatchSchema,
  genericProviderPolicy,
  loadConfig,
} from "../../src/index.js";

const radicaleEnabled = process.env["RADICALE_URL"] !== undefined;
const config = loadConfig({
  CALDAV_PROVIDER: "generic",
  CALDAV_URL: process.env["RADICALE_URL"] ?? "http://127.0.0.1:5232",
  CALDAV_USERNAME: "test",
  CALDAV_PASSWORD: "test",
  CALDAV_MCP_REQUEST_TIMEOUT_MS: "5000",
});

describe.skipIf(!radicaleEnabled)("Radicale gateway contract", () => {
  it("discovers a calendar and performs conditional CRUD", async () => {
    const service = createCalendarService(
      createCalDavGateway(config),
      genericProviderPolicy,
    );
    const calendars = await service.listCalendars();
    const calendar = calendars.find(
      (candidate) => candidate.displayName === "Integration",
    );
    expect(calendar).toBeDefined();
    if (calendar === undefined) {
      throw new Error("Missing Radicale integration calendar");
    }

    const created = await service.createEvent(
      createEventInputSchema.parse({
        calendar_id: calendar.calendarId,
        summary: "Radicale contract event",
        start: {
          date_time: "2026-09-06T03:00:00+02:00",
          timezone: "Europe/Berlin",
        },
        end: {
          date_time: "2026-09-06T03:30:00+02:00",
          timezone: "Europe/Berlin",
        },
        alarms: [{ minutes_before: 60 }, { minutes_before: 0 }],
      }),
    );

    try {
      expect(created.etag).not.toBeNull();
      expect(created.alarms).toHaveLength(2);
      const listed = await service.listEvents(
        calendar.calendarId,
        "2026-09-01T00:00:00Z",
        "2026-10-01T00:00:00Z",
      );
      expect(listed.map((event) => event.uid)).toContain(created.uid);

      const updated = await service.updateEvent({
        resourceId: created.resourceId,
        ...(created.etag === null ? {} : { expectedEtag: created.etag }),
        patch: eventPatchSchema.parse({ summary: "Updated through tsdav" }),
      });
      expect(updated.summary).toBe("Updated through tsdav");
      expect(updated.alarms).toHaveLength(2);

      await service.deleteEvent({
        resourceId: updated.resourceId,
        ...(updated.etag === null ? {} : { expectedEtag: updated.etag }),
      });
      await expect(service.getEvent(updated.resourceId)).rejects.toMatchObject({
        code: "EVENT_NOT_FOUND",
      });
    } catch (cause) {
      await service
        .deleteEvent({ resourceId: created.resourceId })
        .catch(() => undefined);
      throw cause;
    }
  });
});
