import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import {
  createCalendarId,
  createCalendarService,
  createMcpServer,
  createResourceId,
  eventOutputSchema,
  iCloudProviderPolicy,
  listEventsOutputSchema,
  type CalDavGateway,
  type CalendarResource,
} from "../../src/index.js";

const calendarUrl = "https://example.test/calendars/personal/";
const calendarId = createCalendarId(calendarUrl);
const unrelatedUrl = `${calendarUrl}unrelated.ics`;
const unrelatedResource: CalendarResource = {
  calendarId,
  resourceId: createResourceId(calendarUrl, unrelatedUrl),
  url: unrelatedUrl,
  etag: "unrelated-etag",
  data: [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:unrelated",
    "DTSTAMP:20260101T000000Z",
    "DTSTART;TZID=Missing/Zone:20260101T100000",
    "DTEND;TZID=Missing/Zone:20260101T110000",
    "SUMMARY:Unrelated",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n"),
};

const createGateway = (): CalDavGateway => {
  let resource: CalendarResource | null = null;
  let etagVersion = 0;

  const requireResource = (): CalendarResource => {
    if (resource === null) {
      throw new Error("Missing test event");
    }
    return resource;
  };

  return {
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
    listResources: () =>
      Promise.resolve(
        resource === null ? [unrelatedResource] : [unrelatedResource, resource],
      ),
    getResource: () => Promise.resolve(requireResource()),
    createResource: (_calendarId, filename, data) => {
      etagVersion += 1;
      const url = new URL(filename, calendarUrl).href;
      resource = {
        calendarId,
        resourceId: createResourceId(calendarUrl, url),
        url,
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
};

describe("MCP CRUD integration", () => {
  it("creates, finds, patches, and deletes an iCloud event", async () => {
    const gateway = createGateway();
    let uuidSequence = 0;
    const service = createCalendarService(gateway, iCloudProviderPolicy, () => {
      uuidSequence += 1;
      return `fixed-uuid-${String(uuidSequence)}`;
    });
    const server = createMcpServer(service);
    const client = new Client({ name: "integration", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const created = eventOutputSchema.parse(
        (
          await client.callTool({
            name: "create_event",
            arguments: {
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
              alarms: [{ minutes_before: 1440 }, { minutes_before: 0 }],
            },
          })
        ).structuredContent,
      );
      expect(created.alarms).toHaveLength(2);
      expect(created.etag).toBe("etag-1");

      const fetched = eventOutputSchema.parse(
        (
          await client.callTool({
            name: "get_event",
            arguments: {
              calendar_id: calendarId,
              uid: created.uid,
              include_raw_ical: true,
            },
          })
        ).structuredContent,
      );
      expect(fetched.raw_ical).toContain("X-WR-ALARMUID:fixed-uuid-2");
      expect(fetched.raw_ical).toContain("X-APPLE-DEFAULT-ALARM:FALSE");

      const updated = eventOutputSchema.parse(
        (
          await client.callTool({
            name: "update_event",
            arguments: {
              calendar_id: calendarId,
              uid: created.uid,
              expected_etag: created.etag,
              patch: { summary: "Updated" },
            },
          })
        ).structuredContent,
      );
      expect(updated.summary).toBe("Updated");
      expect(updated.alarms).toHaveLength(2);
      expect(updated.etag).toBe("etag-2");

      const deleted = await client.callTool({
        name: "delete_event",
        arguments: {
          calendar_id: calendarId,
          uid: updated.uid,
          expected_etag: updated.etag,
        },
      });
      expect(deleted.structuredContent).toEqual({
        deleted: true,
        resource_id: updated.resource_id,
      });
      expect(await gateway.listResources(calendarId)).toEqual([
        unrelatedResource,
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("lists an iCloud resource with an embedded custom timezone", async () => {
    const url = `${calendarUrl}custom-timezone.ics`;
    const resource: CalendarResource = {
      calendarId,
      resourceId: createResourceId(calendarUrl, url),
      url,
      etag: "custom-etag",
      data: [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VTIMEZONE",
        "TZID:GMT+0545",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0545",
        "TZOFFSETTO:+0545",
        "END:STANDARD",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "UID:custom-timezone",
        "DTSTAMP:20260101T000000Z",
        "DTSTART;TZID=GMT+0545:20260110T100000",
        "DTEND;TZID=GMT+0545:20260110T110000",
        "SUMMARY:Custom timezone",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    };
    const unavailable = (): Promise<never> =>
      Promise.reject(new Error("Not available in this test"));
    const gateway: CalDavGateway = {
      listCalendars: () =>
        Promise.resolve([
          {
            calendarId,
            displayName: "Personal",
            description: null,
            timezone: null,
            writable: true,
          },
        ]),
      listResources: () => Promise.resolve([resource]),
      getResource: () => Promise.resolve(resource),
      createResource: unavailable,
      updateResource: unavailable,
      deleteResource: unavailable,
    };
    const server = createMcpServer(
      createCalendarService(gateway, iCloudProviderPolicy),
    );
    const client = new Client({ name: "integration", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = listEventsOutputSchema.parse(
        (
          await client.callTool({
            name: "list_events",
            arguments: {
              calendar_id: calendarId,
              start: "2026-01-09T00:00:00Z",
              end: "2026-01-11T00:00:00Z",
            },
          })
        ).structuredContent,
      );

      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.start).toEqual({
        date_time: "2026-01-10T10:00:00+05:45",
        timezone: "GMT+0545",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
