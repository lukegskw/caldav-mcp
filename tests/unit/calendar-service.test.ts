import { describe, expect, it } from "vitest";

import {
  createCalendarId,
  createCalendarEvent,
  createCalendarService,
  createEventInputSchema,
  createResourceId,
  eventPatchSchema,
  genericProviderPolicy,
  isAppError,
  type CalDavGateway,
  type CalendarResource,
} from "../../src/index.js";

const calendarUrl = "https://example.test/calendars/personal/";
const resourceUrl = `${calendarUrl}event.ics`;
const calendarId = createCalendarId(calendarUrl);

type FakeGateway = {
  readonly gateway: CalDavGateway;
  readonly currentResource: () => CalendarResource | null;
};

const createFakeGateway = (): FakeGateway => {
  let resource: CalendarResource | null = null;
  let etagVersion = 0;

  const gateway: CalDavGateway = {
    listCalendars: () =>
      Promise.resolve([
        {
          calendarId,
          displayName: "Personal",
          description: null,
          timezone: "Europe/Berlin",
          writable: true,
        },
      ]),
    listResources: () => Promise.resolve(resource === null ? [] : [resource]),
    getResource: () => {
      if (resource === null) {
        return Promise.reject(new Error("Missing fixture resource"));
      }
      return Promise.resolve(resource);
    },
    createResource: (_calendarId, _filename, data) => {
      etagVersion += 1;
      resource = {
        calendarId,
        resourceId: createResourceId(calendarUrl, resourceUrl),
        url: resourceUrl,
        etag: `etag-${String(etagVersion)}`,
        data,
      };
      return Promise.resolve(resource);
    },
    updateResource: (current, data) => {
      etagVersion += 1;
      resource = {
        ...current,
        etag: `etag-${String(etagVersion)}`,
        data,
      };
      return Promise.resolve(resource);
    },
    deleteResource: () => {
      resource = null;
      return Promise.resolve();
    },
  };

  return { gateway, currentResource: () => resource };
};

const input = createEventInputSchema.parse({
  calendar_id: calendarId,
  summary: "Original",
  start: {
    date_time: "2026-09-06T03:00:00+02:00",
    timezone: "Europe/Berlin",
  },
  end: {
    date_time: "2026-09-06T03:30:00+02:00",
    timezone: "Europe/Berlin",
  },
  alarms: [{ minutes_before: 15 }],
});

describe("calendar service", () => {
  it("creates, updates, and deletes an event", async () => {
    const fake = createFakeGateway();
    const service = createCalendarService(
      fake.gateway,
      genericProviderPolicy,
      () => "uuid",
    );

    const created = await service.createEvent(input);
    expect(created.summary).toBe("Original");
    expect(created.etag).toBe("etag-1");

    const updated = await service.updateEvent({
      resourceId: created.resourceId,
      ...(created.etag === null ? {} : { expectedEtag: created.etag }),
      patch: eventPatchSchema.parse({ summary: "Updated" }),
    });
    expect(updated.summary).toBe("Updated");
    expect(updated.alarms).toHaveLength(1);
    expect(updated.etag).toBe("etag-2");

    await service.deleteEvent({
      resourceId: updated.resourceId,
      ...(updated.etag === null ? {} : { expectedEtag: updated.etag }),
    });
    expect(fake.currentResource()).toBeNull();
  });

  it("rejects a stale ETag", async () => {
    const fake = createFakeGateway();
    const service = createCalendarService(
      fake.gateway,
      genericProviderPolicy,
      () => "uuid",
    );
    const created = await service.createEvent(input);

    await expect(
      service.updateEvent({
        resourceId: created.resourceId,
        expectedEtag: "stale",
        patch: eventPatchSchema.parse({ summary: "Unsafe" }),
      }),
    ).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "ETAG_CONFLICT",
    );
  });

  it("finds a UID without normalizing unrelated event timestamps", async () => {
    const unrelatedData = createCalendarEvent({
      input,
      provider: genericProviderPolicy,
      createUuid: () => "unrelated",
    }).replaceAll("Europe/Berlin", "Missing/Zone");
    const targetData = createCalendarEvent({
      input: { ...input, summary: "Target" },
      provider: genericProviderPolicy,
      createUuid: () => "target",
    });
    const unrelatedUrl = `${calendarUrl}unrelated.ics`;
    const targetUrl = `${calendarUrl}target.ics`;
    const unrelated: CalendarResource = {
      calendarId,
      resourceId: createResourceId(calendarUrl, unrelatedUrl),
      url: unrelatedUrl,
      etag: "etag-unrelated",
      data: unrelatedData,
    };
    const target: CalendarResource = {
      calendarId,
      resourceId: createResourceId(calendarUrl, targetUrl),
      url: targetUrl,
      etag: "etag-target",
      data: targetData,
    };
    const unavailable = (): Promise<never> =>
      Promise.reject(new Error("Not available in this test"));
    const gateway: CalDavGateway = {
      listCalendars: () => Promise.resolve([]),
      listResources: () => Promise.resolve([unrelated, target]),
      getResource: (resourceId) =>
        Promise.resolve(resourceId === target.resourceId ? target : unrelated),
      createResource: unavailable,
      updateResource: unavailable,
      deleteResource: unavailable,
    };
    const service = createCalendarService(gateway, genericProviderPolicy);

    await expect(
      service.findEvent(calendarId, "target@caldav-mcp"),
    ).resolves.toMatchObject({
      summary: "Target",
      resourceId: target.resourceId,
    });
    await expect(
      service.findEventResourceId(calendarId, "target@caldav-mcp"),
    ).resolves.toBe(target.resourceId);
  });

  it("preserves ambiguous UID detection with lightweight lookup", async () => {
    const data = createCalendarEvent({
      input,
      provider: genericProviderPolicy,
      createUuid: () => "duplicate",
    });
    const resources = ["one.ics", "two.ics"].map(
      (filename): CalendarResource => {
        const url = `${calendarUrl}${filename}`;
        return {
          calendarId,
          resourceId: createResourceId(calendarUrl, url),
          url,
          etag: null,
          data,
        };
      },
    );
    const unavailable = (): Promise<never> =>
      Promise.reject(new Error("Not available in this test"));
    const gateway: CalDavGateway = {
      listCalendars: () => Promise.resolve([]),
      listResources: () => Promise.resolve(resources),
      getResource: unavailable,
      createResource: unavailable,
      updateResource: unavailable,
      deleteResource: unavailable,
    };
    const service = createCalendarService(gateway, genericProviderPolicy);

    await expect(
      service.findEventResourceId(calendarId, "duplicate@caldav-mcp"),
    ).rejects.toSatisfy(
      (error: unknown) => isAppError(error) && error.code === "AMBIGUOUS_EVENT",
    );
  });

  it("rejects mutation through an occurrence resource identifier", async () => {
    const fake = createFakeGateway();
    const service = createCalendarService(
      fake.gateway,
      genericProviderPolicy,
      () => "uuid",
    );
    await service.createEvent(input);
    const occurrenceId = createResourceId(
      calendarUrl,
      resourceUrl,
      "2026-09-06T03:00:00",
    );

    await expect(
      service.deleteEvent({ resourceId: occurrenceId }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isAppError(error) &&
        error.code === "UNSUPPORTED_RECURRENCE_INSTANCE_MUTATION",
    );
  });

  it("reads an expanded occurrence through its opaque resource identifier", async () => {
    const fake = createFakeGateway();
    const service = createCalendarService(
      fake.gateway,
      genericProviderPolicy,
      () => "uuid",
    );
    await service.createEvent(
      createEventInputSchema.parse({
        ...input,
        rrule: "FREQ=DAILY;COUNT=3",
      }),
    );
    const events = await service.listEvents(
      calendarId,
      "2026-09-05T00:00:00Z",
      "2026-09-10T00:00:00Z",
    );
    const occurrence = events[1];
    expect(occurrence?.recurrenceId).not.toBeNull();
    if (occurrence === undefined) {
      throw new Error("Missing recurrence fixture");
    }

    const fetched = await service.getEvent(occurrence.resourceId);
    expect(fetched.recurrenceId).toBe(occurrence.recurrenceId);
    expect(fetched.start).toEqual(occurrence.start);
    expect(fetched.resourceId).toBe(occurrence.resourceId);
  });
});
