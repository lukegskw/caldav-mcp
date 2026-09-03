import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";

import { createAppError, isAppError } from "../errors.js";
import type { CalendarService } from "../services/index.js";
import { paginateEvents } from "./cursor.js";
import {
  createEventToolInputSchema,
  deleteEventInputSchema,
  deleteEventOutputSchema,
  eventOutputSchema,
  getEventInputSchema,
  listCalendarsInputSchema,
  listCalendarsOutputSchema,
  listEventsInputSchema,
  listEventsOutputSchema,
  updateEventInputSchema,
  type EventLocator,
} from "./schemas.js";
import { serializeCalendar, serializeEvent } from "./serialize.js";

const toolSuccess = (
  structuredContent: Record<string, unknown>,
): CallToolResult => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(structuredContent, null, 2),
    },
  ],
  structuredContent,
});

const toolFailure = (cause: unknown): CallToolResult => {
  const error = isAppError(cause)
    ? {
        code: cause.code,
        message: cause.message,
        retryable: cause.retryable,
      }
    : {
        code: "WRITE_RESULT_UNKNOWN",
        message: "An unexpected internal error occurred",
        retryable: false,
      };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error }) }],
  };
};

const runTool = async (
  operation: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> => {
  try {
    return toolSuccess(await operation());
  } catch (cause) {
    return toolFailure(cause);
  }
};

const resolveResourceId = async (
  service: CalendarService,
  locator: EventLocator,
): Promise<string> => {
  if (locator.resource_id !== undefined) {
    return locator.resource_id;
  }
  if (locator.calendar_id === undefined || locator.uid === undefined) {
    throw createAppError({
      code: "VALIDATION_FAILED",
      message: "An event resource identifier is required",
    });
  }
  return service.findEventResourceId(locator.calendar_id, locator.uid);
};

export const createMcpServer = (service: CalendarService): McpServer => {
  const server = new McpServer({ name: "caldav-mcp", version: "0.1.0" });

  server.registerTool(
    "list_calendars",
    {
      title: "List calendars",
      description: "List calendars available in the configured iCloud account.",
      inputSchema: listCalendarsInputSchema,
      outputSchema: listCalendarsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    () =>
      runTool(async () => ({
        calendars: (await service.listCalendars()).map(serializeCalendar),
      })),
  );

  server.registerTool(
    "list_events",
    {
      title: "List calendar events",
      description:
        "List and expand events in a semi-open time range of up to 366 days.",
      inputSchema: listEventsInputSchema,
      outputSchema: listEventsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(async () => {
        const events = await service.listEvents(
          input.calendar_id,
          input.start,
          input.end,
          input.timezone,
        );
        const page = paginateEvents(input, events);
        return {
          events: page.events.map(serializeEvent),
          next_cursor: page.nextCursor,
        };
      }),
  );

  server.registerTool(
    "get_event",
    {
      title: "Get calendar event",
      description:
        "Read an event by opaque resource ID or by calendar ID and UID.",
      inputSchema: getEventInputSchema,
      outputSchema: eventOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(async () => {
        const event =
          input.resource_id === undefined
            ? await service.findEvent(
                input.calendar_id ?? "",
                input.uid ?? "",
                input.include_raw_ical,
              )
            : await service.getEvent(input.resource_id, input.include_raw_ical);
        return serializeEvent(event);
      }),
  );

  server.registerTool(
    "create_event",
    {
      title: "Create calendar event",
      description:
        "Create an iCloud calendar event with zero or more display alarms.",
      inputSchema: createEventToolInputSchema,
      outputSchema: eventOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(async () => serializeEvent(await service.createEvent(input))),
  );

  server.registerTool(
    "update_event",
    {
      title: "Update calendar event",
      description:
        "Patch an event or recurring series while preserving omitted fields.",
      inputSchema: updateEventInputSchema,
      outputSchema: eventOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(async () => {
        const resourceId = await resolveResourceId(service, input);
        const event = await service.updateEvent({
          resourceId,
          ...(input.expected_etag === undefined
            ? {}
            : { expectedEtag: input.expected_etag }),
          patch: input.patch,
        });
        return serializeEvent(event);
      }),
  );

  server.registerTool(
    "delete_event",
    {
      title: "Delete calendar event",
      description: "Delete an event or complete recurring series.",
      inputSchema: deleteEventInputSchema,
      outputSchema: deleteEventOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(async () => {
        const resourceId = await resolveResourceId(service, input);
        await service.deleteEvent({
          resourceId,
          ...(input.expected_etag === undefined
            ? {}
            : { expectedEtag: input.expected_etag }),
        });
        return { deleted: true, resource_id: resourceId };
      }),
  );

  return server;
};
