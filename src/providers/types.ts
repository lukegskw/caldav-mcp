import type ICAL from "ical.js";

export type ProviderName = "generic" | "icloud";

export type ProviderPolicy = {
  readonly name: ProviderName;
  readonly defaultUrl?: string;
  readonly decorateAlarm: (alarm: ICAL.Component, alarmUid: string) => void;
};
