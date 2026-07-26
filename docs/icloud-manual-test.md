# iCloud manual validation

Run this checklist against a dedicated iCloud test calendar before each release. Never
store credentials or exported calendar bodies in the repository. Record unexecuted
steps as `not run`, not as passing.

1. Discover calendars and confirm the dedicated calendar appears once.
2. Create, read, update, and delete a normal timed event.
3. Create and read an all-day event; confirm the exclusive end date on an Apple device.
4. Create an event with zero alarms.
5. Create an event with one display alarm.
6. Create an event with at least two display alarms and verify both on macOS or iOS.
7. Create a recurring series and list its expanded occurrences across a DST transition.
8. Create an event through MCP, edit it on an Apple device, then patch a different field
   through MCP; confirm the device edit and alarms survive.
9. Confirm that stored `X-APPLE-*`, `X-WR-*`, `VTIMEZONE`, and recurrence exceptions
   survive a patch that does not target them.
10. Attempt a patch with a stale ETag and confirm `ETAG_CONFLICT`.
11. Attempt to mutate one expanded occurrence and confirm the explicit unsupported error.
12. Delete all test events and revoke the test app-specific password when validation is
    complete.
