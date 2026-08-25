import ICAL from "ical.js";

import { createAppError } from "../errors.js";
import { MAX_EVENT_OCCURRENCES_PER_RESOURCE } from "../limits.js";
import {
  isTimedTemporalValue,
  type NormalizedEvent,
  type TemporalValue,
} from "../schemas/index.js";
import {
  componentString,
  findMasterEvent,
  normalizeEventComponent,
  parseCalendar,
  temporalFromIcalTime,
} from "./codec.js";
import { readAlarms } from "./alarms.js";

const iteratorNext = (iterator: ICAL.RecurExpansion): unknown =>
  iterator.next();

type SafeOccurrenceDetails = {
  readonly startDate: ICAL.Time;
  readonly endDate: ICAL.Time;
  readonly item: ICAL.Event;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isOccurrenceDetails = (value: unknown): value is SafeOccurrenceDetails =>
  isRecord(value) &&
  value["startDate"] instanceof ICAL.Time &&
  value["endDate"] instanceof ICAL.Time &&
  value["item"] instanceof ICAL.Event;

const occurrenceDetails = (
  event: ICAL.Event,
  occurrence: ICAL.Time,
): SafeOccurrenceDetails => {
  const value: unknown = event.getOccurrenceDetails(occurrence);
  if (!isOccurrenceDetails(value)) {
    throw createAppError({
      code: "INVALID_ICALENDAR",
      message: "The recurrence expansion returned invalid occurrence data",
    });
  }
  return value;
};

const eventText = (
  event: ICAL.Component,
  propertyName: string,
  fallback: string | null,
): string | null => componentString(event, propertyName) ?? fallback;

const occurrenceTemporal = (
  value: ICAL.Time,
  timezone: unknown,
): TemporalValue => temporalFromIcalTime(value, timezone);

const temporalMilliseconds = (value: TemporalValue): number =>
  Date.parse(
    isTimedTemporalValue(value) ? value.date_time : `${value.date}T00:00:00Z`,
  );

export const expandCalendarEvent = (
  rawCalendar: string,
  rangeStart: string,
  rangeEnd: string,
  maximumOccurrences = MAX_EVENT_OCCURRENCES_PER_RESOURCE,
  fallbackTimezone?: string,
): readonly NormalizedEvent[] => {
  const calendar = parseCalendar(rawCalendar);
  const master = findMasterEvent(calendar);
  const event = new ICAL.Event(master);
  const normalizedMaster = normalizeEventComponent(master, fallbackTimezone);
  if (!event.isRecurring()) {
    return [normalizedMaster];
  }

  const startMilliseconds = Date.parse(rangeStart);
  const endMilliseconds = Date.parse(rangeEnd);
  if (
    Number.isNaN(startMilliseconds) ||
    Number.isNaN(endMilliseconds) ||
    startMilliseconds >= endMilliseconds
  ) {
    throw createAppError({
      code: "VALIDATION_FAILED",
      message: "The event range is invalid",
    });
  }

  const iterator = event.iterator();
  const startProperty = master.getFirstProperty("dtstart");
  const propertyTimezone: unknown = startProperty?.getFirstParameter("tzid");
  const timezone =
    typeof propertyTimezone === "string" && propertyTimezone !== ""
      ? propertyTimezone
      : fallbackTimezone;
  const occurrences: NormalizedEvent[] = [];

  for (let iteration = 0; iteration < 100_000; iteration += 1) {
    const candidate = iteratorNext(iterator);
    if (!(candidate instanceof ICAL.Time)) {
      return occurrences;
    }
    const candidateMilliseconds = temporalMilliseconds(
      occurrenceTemporal(candidate, timezone),
    );
    if (candidateMilliseconds >= endMilliseconds) {
      return occurrences;
    }
    const details = occurrenceDetails(event, candidate);
    const occurrenceStartTemporal = occurrenceTemporal(
      details.startDate,
      timezone,
    );
    const occurrenceEndTemporal = occurrenceTemporal(details.endDate, timezone);
    const occurrenceStart = temporalMilliseconds(occurrenceStartTemporal);
    const occurrenceEnd = temporalMilliseconds(occurrenceEndTemporal);
    if (
      occurrenceStart < endMilliseconds &&
      occurrenceEnd > startMilliseconds
    ) {
      const item = details.item.component;
      const itemAlarms = readAlarms(item);
      occurrences.push({
        ...normalizedMaster,
        summary:
          eventText(item, "summary", normalizedMaster.summary) ??
          normalizedMaster.summary,
        start: occurrenceStartTemporal,
        end: occurrenceEndTemporal,
        description: eventText(
          item,
          "description",
          normalizedMaster.description,
        ),
        location: eventText(item, "location", normalizedMaster.location),
        alarms: itemAlarms.length === 0 ? normalizedMaster.alarms : itemAlarms,
        recurrenceException: details.item.isRecurrenceException(),
        recurrenceId: candidate.toString(),
      });
      if (occurrences.length >= maximumOccurrences) {
        return occurrences;
      }
    }
  }

  throw createAppError({
    code: "RESOURCE_TOO_LARGE",
    message: "The recurrence expansion exceeded its safety limit",
  });
};
