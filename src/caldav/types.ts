export type CalendarInfo = {
  readonly calendarId: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly timezone: string | null;
  readonly writable: boolean | null;
};

export type CalendarResource = {
  readonly calendarId: string;
  readonly resourceId: string;
  readonly url: string;
  readonly etag: string | null;
  readonly data: string;
};

export type CalendarRange = {
  readonly start: string;
  readonly end: string;
};

export type CalDavGateway = {
  readonly listCalendars: () => Promise<readonly CalendarInfo[]>;
  readonly listResources: (
    calendarId: string,
    range?: CalendarRange,
  ) => Promise<readonly CalendarResource[]>;
  readonly getResource: (resourceId: string) => Promise<CalendarResource>;
  readonly createResource: (
    calendarId: string,
    filename: string,
    data: string,
  ) => Promise<CalendarResource>;
  readonly updateResource: (
    resource: CalendarResource,
    data: string,
  ) => Promise<CalendarResource>;
  readonly deleteResource: (resource: CalendarResource) => Promise<void>;
};
