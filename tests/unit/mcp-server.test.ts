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

const recurringEvent = (
  resourceId: string,
  recurrenceId: string,
  dateTime: string,
) => ({
  ...firstEvent,
  resourceId,
  uid: "therapy-series",
  summary: "Therapy",
  start: {
    date_time: dateTime,
    timezone: "Europe/Berlin",
  },
  end: {
    date_time: dateTime.replace("T03:00:00", "T03:30:00"),
    timezone: "Europe/Berlin",
  },
  rrule: "FREQ=WEEKLY",
  recurring: true,
  recurrenceId,
});

const firstOccurrence = recurringEvent(
  "resource-therapy-1",
  "2026-09-13T03:00:00",
  "2026-09-13T03:00:00+02:00",
);

const secondOccurrence = recurringEvent(
  "resource-therapy-2",
  "2026-09-20T03:00:00",
  "2026-09-20T03:00:00+02:00",
);

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
    const decodedCursor: unknown = JSON.parse(
      Buffer.from(first.next_cursor ?? "", "base64url").toString("utf8"),
    );
    expect(decodedCursor).toMatchObject({
      version: 2,
      lastKey: {
        uid: "uid-1",
        recurrenceId: null,
        resourceId: "resource-1",
      },
    });

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

  it("keeps every event exactly once when backend order changes between pages", async () => {
    let calls = 0;
    const base = createService();
    const service: CalendarService = {
      ...base,
      listEvents: () => {
        calls += 1;
        return Promise.resolve(
          calls % 2 === 1
            ? [secondOccurrence, secondEvent, firstOccurrence, firstEvent]
            : [firstOccurrence, firstEvent, secondOccurrence, secondEvent],
        );
      },
    };
    const { client } = await connect(service);
    const arguments_ = {
      calendar_id: "calendar-id",
      start: "2026-09-01T00:00:00Z",
      end: "2026-10-01T00:00:00Z",
      limit: 2,
    };
    const first = listEventsOutputSchema.parse(
      (
        await client.callTool({
          name: "list_events",
          arguments: arguments_,
        })
      ).structuredContent,
    );
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
    const paginated = [...first.events, ...second.events].map((event) => [
      event.uid,
      event.recurrence_id,
    ]);

    expect(paginated).toEqual([
      ["uid-1", null],
      ["uid-2", null],
      ["therapy-series", "2026-09-13T03:00:00"],
      ["therapy-series", "2026-09-20T03:00:00"],
    ]);
    expect(new Set(paginated.map((identity) => identity.join("/"))).size).toBe(
      4,
    );
    expect(second.next_cursor).toBeNull();

    const singlePage = listEventsOutputSchema.parse(
      (
        await client.callTool({
          name: "list_events",
          arguments: { ...arguments_, limit: 500 },
        })
      ).structuredContent,
    );
    expect(
      singlePage.events.map((event) => [event.uid, event.recurrence_id]),
    ).toEqual(paginated);
  });

  it("continues by lastKey when earlier events are inserted or removed", async () => {
    const thirdEvent: EventResult = {
      ...firstEvent,
      resourceId: "resource-3",
      uid: "uid-3",
      summary: "Third",
    };
    const fourthEvent: EventResult = {
      ...firstEvent,
      resourceId: "resource-4",
      uid: "uid-4",
      summary: "Fourth",
    };
    const insertedBefore: EventResult = {
      ...firstEvent,
      resourceId: "resource-0",
      uid: "uid-0",
      summary: "Inserted before cursor",
    };
    let calls = 0;
    const base = createService();
    const service: CalendarService = {
      ...base,
      listEvents: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? [fourthEvent, secondEvent, thirdEvent, firstEvent]
            : [fourthEvent, insertedBefore, thirdEvent],
        );
      },
    };
    const { client } = await connect(service);
    const arguments_ = {
      calendar_id: "calendar-id",
      start: "2026-09-01T00:00:00Z",
      end: "2026-10-01T00:00:00Z",
      limit: 2,
    };
    const first = listEventsOutputSchema.parse(
      (await client.callTool({ name: "list_events", arguments: arguments_ }))
        .structuredContent,
    );
    const second = listEventsOutputSchema.parse(
      (
        await client.callTool({
          name: "list_events",
          arguments: {
            ...arguments_,
            limit: 3,
            ...(first.next_cursor === null
              ? {}
              : { cursor: first.next_cursor }),
          },
        })
      ).structuredContent,
    );

    expect(first.events.map((event) => event.uid)).toEqual(["uid-1", "uid-2"]);
    expect(second.events.map((event) => event.uid)).toEqual(["uid-3", "uid-4"]);
    expect(second.next_cursor).toBeNull();
  });

  it("rejects malformed, incomplete, and legacy cursors", async () => {
    const { client } = await connect(createService());
    const legacyCursor = Buffer.from(
      JSON.stringify({ version: 1, offset: 1, queryHash: "0".repeat(64) }),
      "utf8",
    ).toString("base64url");
    const incompleteCursor = Buffer.from(
      JSON.stringify({ version: 2, queryHash: "0".repeat(64) }),
      "utf8",
    ).toString("base64url");
    const results = await Promise.all(
      ["not-json", incompleteCursor, legacyCursor].map((cursor) =>
        client.callTool({
          name: "list_events",
          arguments: {
            calendar_id: "calendar-id",
            start: "2026-09-01T00:00:00Z",
            end: "2026-10-01T00:00:00Z",
            cursor,
          },
        }),
      ),
    );

    expect(results.every((result) => result.isError === true)).toBe(true);
    expect(
      results.every((result) =>
        JSON.stringify(result.content).includes("pagination cursor is invalid"),
      ),
    ).toBe(true);
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
