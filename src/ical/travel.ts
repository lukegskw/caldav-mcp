import ICAL from "ical.js";

// Apple extension, serialized as X-APPLE-TRAVEL-DURATION;VALUE=DURATION:PT30M.
const travelDurationProperty = "x-apple-travel-duration";
const travelPropertyPrefix = "x-apple-travel-";

const durationFromValue = (value: unknown): ICAL.Duration | null => {
  if (value instanceof ICAL.Duration) {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    return ICAL.Duration.fromString(value);
  }
  return null;
};

export const readTravelMinutes = (event: ICAL.Component): number | null => {
  const property = event.getFirstProperty(travelDurationProperty);
  if (property === null) {
    return null;
  }
  let duration: ICAL.Duration | null;
  try {
    duration = durationFromValue(property.getFirstValue());
  } catch {
    return null;
  }
  if (duration === null) {
    return null;
  }
  const seconds = duration.toSeconds();
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const minutes = Math.round(seconds / 60);
  return Number.isSafeInteger(minutes) && minutes > 0 ? minutes : null;
};

export const isAllDayEvent = (event: ICAL.Component): boolean => {
  const start = event.getFirstPropertyValue("dtstart");
  return start instanceof ICAL.Time && start.isDate;
};

export const setTravelMinutes = (
  event: ICAL.Component,
  minutes: number | null,
): void => {
  if (minutes === null) {
    // Clear related routing metadata as well as the duration.
    // getAllProperties() returns the live internal array, so iterate a copy.
    for (const property of [...event.getAllProperties()]) {
      if (property.name.startsWith(travelPropertyPrefix)) {
        event.removeProperty(property);
      }
    }
    return;
  }
  event.removeAllProperties(travelDurationProperty);
  const property = new ICAL.Property(travelDurationProperty);
  property.resetType("duration");
  property.setValue(ICAL.Duration.fromSeconds(minutes * 60));
  event.addProperty(property);
};
