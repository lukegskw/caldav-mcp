import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";

import { createAppError, isAppError } from "../errors.js";
import type { CalendarService } from "../services/index.js";
import { SERVER_VERSION } from "../version.js";
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
  const server = new McpServer(
    { name: "caldav-mcp", version: SERVER_VERSION },
    {
      instructions:
        "Manage events in one configured iCloud Calendar account. " +
        "Call list_calendars before event operations to obtain an opaque calendar_id, and prefer resource_id when a previous result provides one. " +
        "Create, update, and delete change the remote calendar; individual occurrences of a recurring series cannot be mutated. " +
        "Use expected_etag on updates and deletions when available to avoid overwriting concurrent changes.",
    },
  );

  server.registerTool(
    "list_calendars",
    {
      title: "List calendars",
      description:
        "List calendars available in the configured iCloud account. Use this first to obtain the opaque calendar_id required by list_events and create_event; writable is a best-effort capability indicator.",
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
        "List events that overlap the start-inclusive, end-exclusive interval and expand recurring series into occurrences, across at most 366 days. Use list_calendars first to obtain calendar_id and use get_event instead for one known event. Continue with next_cursor and unchanged query filters when more results are available.",
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
        "Read one event by resource_id, preferably from a previous result, or by the calendar_id and uid pair. Use list_events for range searches. Request raw iCalendar only for controlled diagnostics because it may contain sensitive calendar data.",
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
        "Create a new event in a writable iCloud calendar and return the stored representation; existing events are not changed. Use list_calendars first to obtain calendar_id, and use update_event when the event already exists. Timed values require matching offsets and timezones, all-day end dates are exclusive, and recurrence rules omit the RRULE: prefix.",
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
        "Modify an existing event or entire recurring series; individual expanded occurrences are not supported. Target it by resource_id or by calendar_id with uid. Omitted patch fields are preserved, null clears nullable fields, an empty alarms array removes alarms, and expected_etag can prevent a stale write.",
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
      description:
        "Permanently delete an event or entire recurring series; individual expanded occurrences are not supported. Target it by resource_id or by calendar_id with uid, and supply expected_etag when available to prevent deleting a concurrently changed event.",
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
