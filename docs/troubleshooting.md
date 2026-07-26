# Troubleshooting

## Authentication fails

Use the Apple Account email as `CALDAV_USERNAME` and an app-specific password as
`CALDAV_PASSWORD`. Do not use the primary Apple Account password. Two-factor
authentication must be enabled before Apple permits app-specific password generation.

If the primary password was changed or reset, Apple revokes existing app-specific
passwords. Generate a new one, update the NAS secret, and recreate the container.

## No calendars are discovered

Confirm that iCloud Calendar is enabled for the account and that the configured URL is
`https://caldav.icloud.com`. Test with a newly generated app-specific password. Check
NAS DNS, outbound HTTPS, system time, and TLS inspection before changing the URL.

Opaque `calendar_id` values are bound to fresh discovery results. Rediscover calendars
after an iCloud calendar is deleted, renamed, or moved.

## An update reports an ETag conflict

The event changed after it was read. Fetch it again with `get_event`, review the stored
values, then apply the patch with the new ETag. The server deliberately does not treat a
conflict as success or overwrite a newer version silently.

## A recurring event cannot be updated or deleted

Resource IDs returned for expanded occurrences identify an individual instance and are
read-only in this release. Fetch or retain the master series resource ID to update or
delete the complete series. Isolated occurrence mutation is intentionally unsupported.

## Multiple alarms look different on Apple devices

The iCloud provider writes a separate `VALARM` for every input alarm, with `UID`,
`X-WR-ALARMUID`, and `X-APPLE-DEFAULT-ALARM:FALSE`. Apple clients may still render or
reorder reminders differently across operating system versions.

Use `get_event` with `include_raw_ical: true` only during controlled diagnosis and
inspect the returned `VALARM` components. Raw iCalendar may contain private event data;
never paste it into a public issue. Updates that omit `alarms` preserve the stored alarm
components, while `alarms: []` removes all alarms.

## The container is unhealthy

Check the service and logs:

```sh
docker compose -f compose.example.yaml ps
docker compose -f compose.example.yaml logs caldav-mcp
```

The healthcheck opens TCP port `8100`; it does not validate iCloud credentials. Verify
that `CALDAV_MCP_TRANSPORT=streamable-http`, the bind host is `0.0.0.0`, and the internal
port remains `8100` even when a different host port is published.

## The MCP endpoint is unreachable

From the NAS network, connect to `http://<nas>:8100/mcp`. From the same Compose network,
use `http://caldav-mcp:8100/mcp`. GET requests intentionally return `405`; MCP clients
use POST for Streamable HTTP requests.
