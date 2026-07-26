import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMcpServer,
  listEventsOutputSchema,
  type CalendarService,
  type EventResult,
} from "../../src/index.js";

const firstEvent: EventResult = {
  calendarId: "calendar-id",
  resourceId: "resource-1",
  href: "https://example.test/calendars/private/event-1.ics",
  etag: "etag-1",
  uid: "uid-1",
  summary: "First",
  start: {
    date_time: "2026-09-06T03:00:00+02:00",
    timezone: "Europe/Berlin",
  },
  end: {
    date_time: "2026-09-06T03:30:00+02:00",
    timezone: "Europe/Berlin",
  },
  description: null,
  location: null,
  rrule: null,
  alarms: [],
  recurring: false,
  recurrenceException: false,
  recurrenceId: null,
};

const secondEvent: EventResult = {
  ...firstEvent,
  resourceId: "resource-2",
  uid: "uid-2",
  summary: "Second",
};

const createService = (): CalendarService => ({
  listCalendars: () =>
    Promise.resolve([
      {
        calendarId: "calendar-id",
        displayName: "Personal",
        description: null,
        timezone: "Europe/Berlin",
        writable: true,
      },
    ]),
  listEvents: () => Promise.resolve([firstEvent, secondEvent]),
  getEvent: () => Promise.resolve(firstEvent),
  findEvent: () => Promise.resolve(firstEvent),
  createEvent: () => Promise.resolve(firstEvent),
  updateEvent: () => Promise.resolve(firstEvent),
  deleteEvent: () => Promise.resolve({ deleted: true }),
});

type ConnectedMcp = {
  readonly client: Client;
  readonly close: () => Promise<void>;
};

const connections: Array<() => Promise<void>> = [];

const connect = async (service: CalendarService): Promise<ConnectedMcp> => {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createMcpServer(service);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const close = async (): Promise<void> => {
    await client.close();
    await server.close();
  };
  connections.push(close);
  return { client, close };
};

afterEach(async () => {
  await Promise.all(connections.splice(0).map((close) => close()));
});

describe("MCP server", () => {
  it("publishes all six tools with their risk annotations", async () => {
    const { client } = await connect(createService());
    const tools = await client.listTools();

    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "list_calendars",
      "list_events",
      "get_event",
      "create_event",
      "update_event",
      "delete_event",
    ]);
    expect(tools.tools[0]?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(tools.tools[5]?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(tools.tools.every((tool) => tool.outputSchema !== undefined)).toBe(
      true,
    );
  });

  it("returns structured, paginated event results with a bound cursor", async () => {
    const { client } = await connect(createService());
    const arguments_ = {
      calendar_id: "calendar-id",
      start: "2026-09-01T00:00:00Z",
      end: "2026-10-01T00:00:00Z",
      limit: 1,
    };
    const first = listEventsOutputSchema.parse(
      (
        await client.callTool({
          name: "list_events",
          arguments: arguments_,
        })
      ).structuredContent,
    );

    expect(first.events.map((event) => event.summary)).toEqual(["First"]);
    expect(first.events[0]?.href).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(first.next_cursor).not.toBeNull();

    const second = listEventsOutputSchema.parse(
      (
        await client.callTool({
          name: "list_events",
          arguments: {
            ...arguments_,
            ...(first.next_cursor === null
              ? {}
              : { cursor: first.next_cursor }),
          },
        })
      ).structuredContent,
    );
    expect(second.events.map((event) => event.summary)).toEqual(["Second"]);
    expect(second.next_cursor).toBeNull();

    const mismatched = await client.callTool({
      name: "list_events",
      arguments: {
        ...arguments_,
        end: "2026-10-02T00:00:00Z",
        ...(first.next_cursor === null ? {} : { cursor: first.next_cursor }),
      },
    });
    expect(mismatched.isError).toBe(true);
    expect(JSON.stringify(mismatched.content)).toContain(
      "cursor does not match this query",
    );
  });

  it("does not expose unexpected errors through MCP", async () => {
    const base = createService();
    const service: CalendarService = {
      ...base,
      getEvent: () => Promise.reject(new Error("secret calendar payload")),
    };
    const { client } = await connect(service);
    const result = await client.callTool({
      name: "get_event",
      arguments: { resource_id: "resource-1" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).not.toContain(
      "secret calendar payload",
    );
    expect(JSON.stringify(result.content)).toContain(
      "An unexpected internal error occurred",
    );
  });
});
