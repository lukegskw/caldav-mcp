import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import {
  createCalendarId,
  createCalendarService,
  createMcpServer,
  createResourceId,
  eventOutputSchema,
  iCloudProviderPolicy,
  type CalDavGateway,
  type CalendarResource,
} from "../../src/index.js";

const calendarUrl = "https://example.test/calendars/personal/";
const calendarId = createCalendarId(calendarUrl);

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
    listResources: () => Promise.resolve(resource === null ? [] : [resource]),
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
          resource_id: updated.resource_id,
          expected_etag: updated.etag,
        },
      });
      expect(deleted.structuredContent).toEqual({
        deleted: true,
        resource_id: updated.resource_id,
      });
      expect(await gateway.listResources(calendarId)).toEqual([]);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
