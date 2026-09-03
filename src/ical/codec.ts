import { randomUUID } from "node:crypto";

import ICAL from "ical.js";

import { createAppError, isAppError } from "../errors.js";
import {
  isTimedTemporalValue,
  type CalendarTemporalValue,
  type CreateEventInput,
  type EventPatch,
  type NormalizedEvent,
  type TemporalValue,
} from "../schemas/index.js";
import type { ProviderPolicy } from "../providers/index.js";
import { addAlarms, readAlarms } from "./alarms.js";

const productId = "-//caldav-mcp//CalDAV MCP Server//EN";

export const componentString = (
  component: ICAL.Component,
  propertyName: string,
): string | null => {
  const value = component.getFirstPropertyValue(propertyName);
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : value.toString();
};

const createCalendar = (): ICAL.Component => {
  const calendar = new ICAL.Component("vcalendar");
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", productId);
  calendar.addPropertyWithValue("calscale", "GREGORIAN");
  return calendar;
};

const addTemporalProperty = (
  component: ICAL.Component,
  propertyName: string,
  value: TemporalValue,
): void => {
  const property = new ICAL.Property(propertyName);
  if (isTimedTemporalValue(value)) {
    property.setParameter("tzid", value.timezone);
    property.setValue(
      ICAL.Time.fromDateTimeString(value.date_time.slice(0, 19)),
    );
  } else {
    property.setValue(ICAL.Time.fromDateString(value.date));
  }
  component.addProperty(property);
};

const replaceTemporalProperty = (
  component: ICAL.Component,
  propertyName: string,
  value: TemporalValue,
): void => {
  component.removeAllProperties(propertyName);
  addTemporalProperty(component, propertyName, value);
};

const replaceTextProperty = (
  component: ICAL.Component,
  propertyName: string,
  value: string | null,
): void => {
  component.removeAllProperties(propertyName);
  if (value !== null) {
    component.addPropertyWithValue(propertyName, value);
  }
};

const addRecurrenceRule = (
  component: ICAL.Component,
  recurrenceRule: string,
): void => {
  try {
    component.addPropertyWithValue(
      "rrule",
      ICAL.Recur.fromString(recurrenceRule),
    );
  } catch (cause) {
    throw createAppError({
      code: "INVALID_RRULE",
      message: "The recurrence rule is invalid",
      cause,
    });
  }
};

export const parseCalendar = (rawCalendar: string): ICAL.Component => {
  if (Buffer.byteLength(rawCalendar, "utf8") > 5 * 1024 * 1024) {
    throw createAppError({
      code: "RESOURCE_TOO_LARGE",
      message: "The iCalendar resource exceeds the 5 MiB limit",
    });
  }
  try {
    const calendar = ICAL.Component.fromString(rawCalendar);
    if (calendar.name !== "vcalendar") {
      throw new Error("The root component is not VCALENDAR");
    }
    return calendar;
  } catch (cause) {
    throw createAppError({
      code: "INVALID_ICALENDAR",
      message: "The server returned invalid iCalendar data",
      cause,
    });
  }
};

export type CalendarDocument = {
  readonly calendar: ICAL.Component;
  readonly timezones: ReadonlyMap<string, CalendarTimezoneDefinition>;
};

export type CalendarTimezoneDefinition = {
  readonly timezone: ICAL.Timezone;
  readonly truncatedSubminuteOffsets: ReadonlySet<number>;
};

const invalidCalendarTimezone = (cause?: unknown): Error =>
  createAppError({
    code: "INVALID_ICALENDAR",
    message: "The event contains an invalid timezone definition",
    ...(cause === undefined ? {} : { cause }),
  });

const validateTimezoneComponent = (component: ICAL.Component): void => {
  const observances = [
    ...component.getAllSubcomponents("standard"),
    ...component.getAllSubcomponents("daylight"),
  ];
  if (observances.length === 0) {
    throw invalidCalendarTimezone();
  }
  for (const observance of observances) {
    if (
      !observance.hasProperty("dtstart") ||
      !observance.hasProperty("tzoffsetfrom") ||
      !observance.hasProperty("tzoffsetto")
    ) {
      throw invalidCalendarTimezone();
    }
  }
};

const truncatedSubminuteOffset = (value: unknown): number | null => {
  if (typeof value !== "string") {
    return null;
  }
  const match = /^([+-])(\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (match === null || match[4] === "00") {
    return null;
  }
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 23 || minutes > 59) {
    throw invalidCalendarTimezone();
  }
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (hours * 60 + minutes) * 60;
};

const timezoneDefinition = (
  component: ICAL.Component,
  tzid: string,
): CalendarTimezoneDefinition => {
  const truncatedSubminuteOffsets = new Set<number>();
  const observances = [
    ...component.getAllSubcomponents("standard"),
    ...component.getAllSubcomponents("daylight"),
  ];
  for (const observance of observances) {
    for (const propertyName of ["tzoffsetfrom", "tzoffsetto"]) {
      const property = observance.getFirstProperty(propertyName);
      const offset = truncatedSubminuteOffset(property?.jCal[3]);
      if (offset !== null) {
        truncatedSubminuteOffsets.add(offset);
      }
    }
  }
  return {
    timezone: new ICAL.Timezone({ component, tzid }),
    truncatedSubminuteOffsets,
  };
};

export const parseCalendarDocument = (
  rawCalendar: string,
): CalendarDocument => {
  const calendar = parseCalendar(rawCalendar);
  const timezones = new Map<string, CalendarTimezoneDefinition>();
  for (const component of calendar.getAllSubcomponents("vtimezone")) {
    const tzid = componentString(component, "tzid");
    if (tzid === null || tzid === "") {
      throw invalidCalendarTimezone();
    }
    const existing = timezones.get(tzid);
    if (existing !== undefined) {
      if (existing.timezone.component.toString() !== component.toString()) {
        throw invalidCalendarTimezone();
      }
      continue;
    }
    try {
      validateTimezoneComponent(component);
      timezones.set(tzid, timezoneDefinition(component, tzid));
    } catch (cause) {
      if (isAppError(cause)) {
        throw cause;
      }
      throw invalidCalendarTimezone(cause);
    }
  }
  return { calendar, timezones };
};

export const findMasterEvent = (calendar: ICAL.Component): ICAL.Component => {
  const masters = calendar
    .getAllSubcomponents("vevent")
    .filter((event) => !event.hasProperty("recurrence-id"));
  const master = masters[0];
  if (master === undefined) {
    throw createAppError({
      code: "INVALID_ICALENDAR",
      message: "The iCalendar resource does not contain a master VEVENT",
    });
  }
  return master;
};

const pad = (value: number): string => String(value).padStart(2, "0");

const localDateTimeFromIcal = (value: ICAL.Time): string =>
  `${String(value.year).padStart(4, "0")}-${pad(value.month)}-${pad(
    value.day,
  )}T${pad(value.hour)}:${pad(value.minute)}:${pad(value.second)}`;

const formatInstantInTimezone = (
  instant: Date,
  timezone: string,
): string | null => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  const second = values.get("second");
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
};

const offsetString = (offsetMinutes: number): string => {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
};

const embeddedZonedDateTime = (
  value: ICAL.Time,
  localDateTime: string,
  definition: CalendarTimezoneDefinition,
): string => {
  try {
    const offsetSeconds = definition.timezone.utcOffset(value);
    if (
      !Number.isInteger(offsetSeconds) ||
      offsetSeconds % 60 !== 0 ||
      Math.abs(offsetSeconds) >= 24 * 60 * 60 ||
      definition.truncatedSubminuteOffsets.has(offsetSeconds)
    ) {
      throw invalidCalendarTimezone();
    }
    return `${localDateTime}${offsetString(offsetSeconds / 60)}`;
  } catch (cause) {
    if (isAppError(cause)) {
      throw cause;
    }
    throw invalidCalendarTimezone(cause);
  }
};

const zonedDateTime = (localDateTime: string, timezone: string): string => {
  const naiveMilliseconds = Date.parse(`${localDateTime}Z`);
  for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
    const candidate = new Date(naiveMilliseconds - offset * 60_000);
    if (formatInstantInTimezone(candidate, timezone) === localDateTime) {
      return `${localDateTime}${offsetString(offset)}`;
    }
  }
  throw createAppError({
    code: "INVALID_ICALENDAR",
    message: "The event contains an unresolved timezone date-time",
  });
};

export const temporalFromIcalTime = (
  value: ICAL.Time,
  timezone: unknown,
  timezones: ReadonlyMap<string, CalendarTimezoneDefinition> = new Map(),
): CalendarTemporalValue => {
  if (value.isDate) {
    return { date: value.toString() };
  }
  const localDateTime = localDateTimeFromIcal(value);
  if (typeof timezone === "string" && timezone !== "") {
    const embeddedTimezone = timezones.get(timezone);
    if (embeddedTimezone !== undefined) {
      return {
        date_time: embeddedZonedDateTime(
          value,
          localDateTime,
          embeddedTimezone,
        ),
        timezone,
      };
    }
    try {
      return {
        date_time: zonedDateTime(localDateTime, timezone),
        timezone,
      };
    } catch (cause) {
      if (isAppError(cause)) {
        throw cause;
      }
      throw invalidCalendarTimezone(cause);
    }
  }
  return {
    date_time: `${localDateTime}Z`,
    timezone: "UTC",
  };
};

const readTemporalProperty = (
  event: ICAL.Component,
  propertyName: string,
  fallbackTimezone?: string,
  timezones: ReadonlyMap<string, CalendarTimezoneDefinition> = new Map(),
): CalendarTemporalValue => {
  const property = event.getFirstProperty(propertyName);
  if (property === null) {
    throw createAppError({
      code: "INVALID_ICALENDAR",
      message: `The event is missing ${propertyName.toUpperCase()}`,
    });
  }
  const value = property.getFirstValue();
  if (!(value instanceof ICAL.Time)) {
    throw createAppError({
      code: "INVALID_ICALENDAR",
      message: `The event is missing a valid ${propertyName.toUpperCase()}`,
    });
  }
  const propertyTimezone: unknown = property.getFirstParameter("tzid");
  const timezone =
    typeof propertyTimezone === "string" && propertyTimezone !== ""
      ? propertyTimezone
      : fallbackTimezone;
  return temporalFromIcalTime(value, timezone, timezones);
};

export type CreateCalendarEventOptions = {
  readonly input: CreateEventInput;
  readonly provider: ProviderPolicy;
  readonly now?: Date;
  readonly createUuid?: () => string;
};

export const createCalendarEvent = ({
  input,
  provider,
  now = new Date(),
  createUuid = randomUUID,
}: CreateCalendarEventOptions): string => {
  const calendar = createCalendar();
  const event = new ICAL.Component("vevent");
  event.addPropertyWithValue("uid", `${createUuid()}@caldav-mcp`);
  event.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(now, true));
  event.addPropertyWithValue("summary", input.summary);
  addTemporalProperty(event, "dtstart", input.start);
  addTemporalProperty(event, "dtend", input.end);
  if (input.description !== null) {
    event.addPropertyWithValue("description", input.description);
  }
  if (input.location !== null) {
    event.addPropertyWithValue("location", input.location);
  }
  if (input.rrule !== null) {
    addRecurrenceRule(event, input.rrule);
  }
  addAlarms({
    event,
    alarms: input.alarms,
    summary: input.summary,
    provider,
    createUuid,
  });
  calendar.addSubcomponent(event);
  return calendar.toString();
};

export const normalizeEventComponent = (
  master: ICAL.Component,
  fallbackTimezone?: string,
  timezones: ReadonlyMap<string, CalendarTimezoneDefinition> = new Map(),
): NormalizedEvent => {
  const event = new ICAL.Event(master);
  const uid = componentString(master, "uid");
  if (uid === null || uid === "") {
    throw createAppError({
      code: "INVALID_ICALENDAR",
      message: "The event does not contain a UID",
    });
  }
  return {
    uid,
    summary: componentString(master, "summary") ?? "",
    start: readTemporalProperty(master, "dtstart", fallbackTimezone, timezones),
    end: readTemporalProperty(master, "dtend", fallbackTimezone, timezones),
    description: componentString(master, "description"),
    location: componentString(master, "location"),
    rrule: componentString(master, "rrule"),
    alarms: readAlarms(master),
    recurring: event.isRecurring(),
    recurrenceException: event.isRecurrenceException(),
    recurrenceId: componentString(master, "recurrence-id"),
  };
};

export const normalizeCalendarEvent = (
  rawCalendar: string,
  fallbackTimezone?: string,
): NormalizedEvent => {
  const document = parseCalendarDocument(rawCalendar);
  return normalizeEventComponent(
    findMasterEvent(document.calendar),
    fallbackTimezone,
    document.timezones,
  );
};

export const extractCalendarEventUid = (rawCalendar: string): string => {
  const uid = componentString(
    findMasterEvent(parseCalendar(rawCalendar)),
    "uid",
  );
  if (uid === null || uid === "") {
    throw createAppError({
      code: "INVALID_ICALENDAR",
      message: "The event does not contain a UID",
    });
  }
  return uid;
};

export type PatchCalendarEventOptions = {
  readonly rawCalendar: string;
  readonly patch: EventPatch;
  readonly provider: ProviderPolicy;
  readonly now?: Date;
  readonly createUuid?: () => string;
};

export const patchCalendarEvent = ({
  rawCalendar,
  patch,
  provider,
  now = new Date(),
  createUuid = randomUUID,
}: PatchCalendarEventOptions): string => {
  const calendar = parseCalendar(rawCalendar);
  const event = findMasterEvent(calendar);
  if (event.hasProperty("recurrence-id")) {
    throw createAppError({
      code: "UNSUPPORTED_RECURRENCE_INSTANCE_MUTATION",
      message: "Updating a single recurrence instance is not supported",
    });
  }
  if (patch.summary !== undefined) {
    replaceTextProperty(event, "summary", patch.summary);
  }
  if (patch.start !== undefined && patch.end !== undefined) {
    replaceTemporalProperty(event, "dtstart", patch.start);
    replaceTemporalProperty(event, "dtend", patch.end);
  }
  if (patch.description !== undefined) {
    replaceTextProperty(event, "description", patch.description);
  }
  if (patch.location !== undefined) {
    replaceTextProperty(event, "location", patch.location);
  }
  if (patch.rrule !== undefined) {
    event.removeAllProperties("rrule");
    if (patch.rrule !== null) {
      addRecurrenceRule(event, patch.rrule);
    }
  }
  if (patch.alarms !== undefined) {
    event.removeAllSubcomponents("valarm");
    addAlarms({
      event,
      alarms: patch.alarms,
      summary: patch.summary ?? componentString(event, "summary") ?? "Reminder",
      provider,
      createUuid,
    });
  }
  event.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(now, true));
  return calendar.toString();
};
