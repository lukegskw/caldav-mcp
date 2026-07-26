import ICAL from "ical.js";

import type { ProviderPolicy } from "../providers/index.js";
import type { AlarmInput, NormalizedAlarm } from "../schemas/index.js";

const minutesToTrigger = (minutesBefore: number): string => {
  if (minutesBefore === 0) {
    return "PT0S";
  }
  if (minutesBefore % 1_440 === 0) {
    return `-P${String(minutesBefore / 1_440)}D`;
  }
  if (minutesBefore % 60 === 0) {
    return `-PT${String(minutesBefore / 60)}H`;
  }
  return `-PT${String(minutesBefore)}M`;
};

const componentString = (
  component: ICAL.Component,
  propertyName: string,
): string | null => {
  const value = component.getFirstPropertyValue(propertyName);
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : value.toString();
};

export type AddAlarmsOptions = {
  readonly event: ICAL.Component;
  readonly alarms: readonly AlarmInput[];
  readonly summary: string;
  readonly provider: ProviderPolicy;
  readonly createUuid: () => string;
};

export const addAlarms = ({
  event,
  alarms,
  summary,
  provider,
  createUuid,
}: AddAlarmsOptions): void => {
  alarms.forEach((alarmInput) => {
    const alarm = new ICAL.Component("valarm");
    const alarmUid = `${createUuid()}@caldav-mcp`;
    alarm.addPropertyWithValue("action", alarmInput.action);
    alarm.addPropertyWithValue(
      "trigger",
      ICAL.Duration.fromString(minutesToTrigger(alarmInput.minutes_before)),
    );
    alarm.addPropertyWithValue(
      "description",
      alarmInput.description ?? `Reminder: ${summary}`,
    );
    alarm.addPropertyWithValue("uid", alarmUid);
    provider.decorateAlarm(alarm, alarmUid);
    event.addSubcomponent(alarm);
  });
};

export const readAlarms = (event: ICAL.Component): readonly NormalizedAlarm[] =>
  event.getAllSubcomponents("valarm").map((alarm) => {
    const trigger = alarm.getFirstPropertyValue("trigger");
    const seconds =
      trigger instanceof ICAL.Duration ? trigger.toSeconds() : null;
    return {
      uid: componentString(alarm, "uid"),
      minutesBefore:
        seconds !== null && seconds <= 0 ? Math.abs(seconds) / 60 : null,
      action: componentString(alarm, "action") ?? "UNKNOWN",
      description: componentString(alarm, "description"),
    };
  });
