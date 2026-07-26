import { randomUUID } from "node:crypto";

import {
  createResourceId,
  readResourceId,
  type CalDavGateway,
  type CalendarInfo,
} from "../caldav/index.js";
import { createAppError } from "../errors.js";
import {
  createCalendarEvent,
  expandCalendarEvent,
  normalizeCalendarEvent,
  patchCalendarEvent,
} from "../ical/index.js";
import type { ProviderPolicy } from "../providers/index.js";
import type {
  CreateEventInput,
  EventPatch,
  NormalizedEvent,
} from "../schemas/index.js";

export type EventResult = NormalizedEvent & {
  readonly calendarId: string;
  readonly resourceId: string;
  readonly href: string;
  readonly etag: string | null;
  readonly rawIcal?: string;
};

export type UpdateEventInput = {
  readonly resourceId: string;
  readonly expectedEtag?: string;
  readonly patch: EventPatch;
};

export type DeleteEventInput = {
  readonly resourceId: string;
  readonly expectedEtag?: string;
};

export type CalendarService = {
  readonly listCalendars: () => Promise<readonly CalendarInfo[]>;
  readonly listEvents: (
    calendarId: string,
    start: string,
    end: string,
    timezone?: string,
  ) => Promise<readonly EventResult[]>;
  readonly getEvent: (
    resourceId: string,
    includeRawIcal?: boolean,
  ) => Promise<EventResult>;
  readonly findEvent: (
    calendarId: string,
    uid: string,
    includeRawIcal?: boolean,
  ) => Promise<EventResult>;
  readonly createEvent: (input: CreateEventInput) => Promise<EventResult>;
  readonly updateEvent: (input: UpdateEventInput) => Promise<EventResult>;
  readonly deleteEvent: (input: DeleteEventInput) => Promise<{ deleted: true }>;
};

const eventResult = (
  resource: Awaited<ReturnType<CalDavGateway["getResource"]>>,
  includeRawIcal = false,
  event: NormalizedEvent = normalizeCalendarEvent(resource.data),
): EventResult => ({
  ...event,
  calendarId: resource.calendarId,
  resourceId: resource.resourceId,
  href: resource.url,
  etag: resource.etag,
  ...(includeRawIcal ? { rawIcal: resource.data } : {}),
});

const occurrenceRange = (
  recurrenceId: string,
): { readonly start: string; readonly end: string } => {
  const date = recurrenceId.slice(0, 10);
  const dateMilliseconds = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(dateMilliseconds)) {
    throw createAppError({
      code: "VALIDATION_FAILED",
      message: "The recurrence identifier is invalid",
    });
  }
  const dayMilliseconds = 24 * 60 * 60 * 1_000;
  return {
    start: new Date(dateMilliseconds - 2 * dayMilliseconds).toISOString(),
    end: new Date(dateMilliseconds + 3 * dayMilliseconds).toISOString(),
  };
};

const requireExpectedEtag = (
  actualEtag: string | null,
  expectedEtag?: string,
): void => {
  if (expectedEtag !== undefined && expectedEtag !== actualEtag) {
    throw createAppError({
      code: "ETAG_CONFLICT",
      message: "The calendar event changed since it was read",
    });
  }
};

export const createCalendarService = (
  gateway: CalDavGateway,
  provider: ProviderPolicy,
  createUuid: () => string = randomUUID,
): CalendarService => {
  const getEvent = async (
    resourceId: string,
    includeRawIcal = false,
  ): Promise<EventResult> => {
    const handle = readResourceId(resourceId);
    const resource = await gateway.getResource(resourceId);
    if (handle.recurrenceId === undefined) {
      return eventResult(resource, includeRawIcal);
    }
    const range = occurrenceRange(handle.recurrenceId);
    const occurrence = expandCalendarEvent(
      resource.data,
      range.start,
      range.end,
    ).find((event) => event.recurrenceId === handle.recurrenceId);
    if (occurrence === undefined) {
      throw createAppError({
        code: "EVENT_NOT_FOUND",
        message: "The recurring event occurrence was not found",
      });
    }
    return {
      ...eventResult(resource, includeRawIcal, occurrence),
      resourceId,
    };
  };

  const findEvent = async (
    calendarId: string,
    uid: string,
    includeRawIcal = false,
  ): Promise<EventResult> => {
    const resources = await gateway.listResources(calendarId);
    const matching = resources.filter(
      (resource) => normalizeCalendarEvent(resource.data).uid === uid,
    );
    if (matching.length === 0) {
      throw createAppError({
        code: "EVENT_NOT_FOUND",
        message: "The calendar event was not found",
      });
    }
    if (matching.length > 1) {
      throw createAppError({
        code: "AMBIGUOUS_EVENT",
        message: "More than one calendar event has the requested UID",
      });
    }
    const match = matching[0];
    if (match === undefined) {
      throw createAppError({
        code: "EVENT_NOT_FOUND",
        message: "The calendar event was not found",
      });
    }
    return eventResult(match, includeRawIcal);
  };

  const requireSeriesResource = (resourceId: string): void => {
    if (readResourceId(resourceId).recurrenceId !== undefined) {
      throw createAppError({
        code: "UNSUPPORTED_RECURRENCE_INSTANCE_MUTATION",
        message: "Mutating a single recurrence instance is not supported",
      });
    }
  };

  const createEvent = async (input: CreateEventInput): Promise<EventResult> => {
    const calendarData = createCalendarEvent({
      input,
      provider,
      createUuid,
    });
    const normalized = normalizeCalendarEvent(calendarData);
    const resource = await gateway.createResource(
      input.calendar_id,
      `${encodeURIComponent(normalized.uid)}.ics`,
      calendarData,
    );
    return eventResult(resource);
  };

  const updateEvent = async ({
    resourceId,
    expectedEtag,
    patch,
  }: UpdateEventInput): Promise<EventResult> => {
    requireSeriesResource(resourceId);
    const resource = await gateway.getResource(resourceId);
    requireExpectedEtag(resource.etag, expectedEtag);
    const updatedData = patchCalendarEvent({
      rawCalendar: resource.data,
      patch,
      provider,
      createUuid,
    });
    return eventResult(await gateway.updateResource(resource, updatedData));
  };

  const deleteEvent = async ({
    resourceId,
    expectedEtag,
  }: DeleteEventInput): Promise<{ deleted: true }> => {
    requireSeriesResource(resourceId);
    const resource = await gateway.getResource(resourceId);
    requireExpectedEtag(resource.etag, expectedEtag);
    await gateway.deleteResource(resource);
    return { deleted: true };
  };

  return {
    listCalendars: gateway.listCalendars,
    listEvents: async (calendarId, start, end, timezone) => {
      const resources = await gateway.listResources(calendarId, { start, end });
      return resources.flatMap((resource) =>
        expandCalendarEvent(resource.data, start, end, 500, timezone).map(
          (event) => ({
            ...event,
            calendarId: resource.calendarId,
            resourceId:
              event.recurrenceId === null
                ? resource.resourceId
                : createResourceId(
                    readResourceId(resource.resourceId).calendarUrl,
                    resource.url,
                    event.recurrenceId,
                  ),
            href: resource.url,
            etag: resource.etag,
          }),
        ),
      );
    },
    getEvent,
    findEvent,
    createEvent,
    updateEvent,
    deleteEvent,
  };
};
