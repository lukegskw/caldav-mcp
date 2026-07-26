import type { ProviderPolicy } from "./types.js";

export const iCloudProviderPolicy: ProviderPolicy = {
  name: "icloud",
  defaultUrl: "https://caldav.icloud.com",
  decorateAlarm: (alarm, alarmUid) => {
    alarm.addPropertyWithValue("x-wr-alarmuid", alarmUid);
    alarm.addPropertyWithValue("x-apple-default-alarm", "FALSE");
  },
};
