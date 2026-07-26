import type { ProviderPolicy } from "./types.js";

export const genericProviderPolicy: ProviderPolicy = {
  name: "generic",
  decorateAlarm: () => undefined,
};
