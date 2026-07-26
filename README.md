# CalDAV MCP Server

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CI](https://github.com/lukegskw/caldav-mcp/actions/workflows/container.yml/badge.svg)](https://github.com/lukegskw/caldav-mcp/actions/workflows/container.yml)
[![Container](https://img.shields.io/badge/GHCR-amd64%20%7C%20arm64-2496ED?logo=docker&logoColor=white)](https://github.com/lukegskw/caldav-mcp/pkgs/container/caldav-mcp)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**CalDAV MCP Server** is a Model Context Protocol server for managing iCloud Calendar
events, including native support for multiple `VALARM` reminders on one event.

iCloud Calendar is the only provider officially supported and manually validated in the
first release. The server works with any MCP client that supports `stdio` or Streamable
HTTP.

This independent project is not affiliated with, authorized, sponsored, or approved by
Apple Inc. Apple and iCloud are trademarks of their respective owner.

## Navigation

- [About](#about)
- [Features](#features)
- [MCP tools](#mcp-tools)
- [Tech stack](#tech-stack)
- [Installation](#installation)
- [Configuration](#configuration)
- [MCP client setup](#mcp-client-setup)
- [Verification](#verification)
- [Limitations](#limitations)
- [Contributing](#contributing)

## About

The server connects one configured account to iCloud through CalDAV. It discovers the
account's calendars and exposes normalized read and write operations through MCP.

Updates preserve the complete iCalendar resource, including unknown properties, Apple
extensions, `VTIMEZONE`, recurrence exceptions, and alarms omitted from a patch. Writes
use opaque resource identifiers and ETags instead of assuming that a CalDAV filename
matches an event UID.

Calendar resources are processed in memory. The server has no telemetry and no
application database, and raw iCalendar is returned only when explicitly requested.

## Features

- Discovers calendars available to the configured iCloud account.
- Lists events in semi-open time ranges and expands recurring occurrences.
- Creates timed, all-day, and recurring events.
- Supports zero, one, or multiple display alarms per event.
- Emits the Apple alarm extensions expected by iCloud Calendar.
- Reads events by opaque resource ID or by calendar ID and UID.
- Applies partial updates while preserving omitted and unknown iCalendar data.
- Uses ETags for optimistic concurrency on updates and deletions.
- Rejects isolated recurrence mutations instead of changing the complete series.
- Redacts credentials, raw calendar content, and CalDAV paths from logs and errors.
- Runs as a non-root container with a read-only root filesystem configuration.
- Supports `stdio` and Streamable HTTP MCP transports.

## MCP tools

### `list_calendars`

Lists the calendars discovered for the configured account. Each result includes an
opaque `calendar_id`, display name, description, timezone, and best-effort write status.

### `list_events`

Lists events in a semi-open interval and expands recurring occurrences. The maximum
range is 366 days, the default page size is 100, and the maximum page size is 500.

Example input:

```json
{
  "calendar_id": "opaque-calendar-id",
  "start": "2026-09-01T00:00:00Z",
  "end": "2026-10-01T00:00:00Z",
  "timezone": "Europe/Berlin",
  "limit": 100
}
```

### `get_event`

Reads an event by `resource_id`, or by a `calendar_id` and UID pair. Raw iCalendar is
excluded by default and can be requested with `include_raw_ical: true` for controlled
diagnostics.

### `create_event`

Creates an event and reads back the representation stored by the server.

Timed event with two alarms:

```json
{
  "calendar_id": "opaque-calendar-id",
  "summary": "Buy Shinkansen tickets",
  "start": {
    "date_time": "2026-09-06T03:00:00+02:00",
    "timezone": "Europe/Berlin"
  },
  "end": {
    "date_time": "2026-09-06T03:30:00+02:00",
    "timezone": "Europe/Berlin"
  },
  "description": "Smart-EX",
  "location": null,
  "alarms": [
    { "minutes_before": 1440, "action": "DISPLAY" },
    { "minutes_before": 0, "action": "DISPLAY" }
  ],
  "rrule": null
}
```

All-day event with an exclusive end date:

```json
{
  "calendar_id": "opaque-calendar-id",
  "summary": "Trip",
  "start": { "date": "2026-09-06" },
  "end": { "date": "2026-09-08" },
  "alarms": []
}
```

Recurring events accept an RFC 5545 rule without the `RRULE:` prefix:

```json
{
  "calendar_id": "opaque-calendar-id",
  "summary": "Weekly planning",
  "start": {
    "date_time": "2026-09-07T09:00:00+02:00",
    "timezone": "Europe/Berlin"
  },
  "end": {
    "date_time": "2026-09-07T09:30:00+02:00",
    "timezone": "Europe/Berlin"
  },
  "rrule": "FREQ=WEEKLY;BYDAY=MO;COUNT=10"
}
```

### `update_event`

Patches an event or complete recurring series. Omitted fields are preserved, `null`
removes a nullable field, and `alarms: []` removes all alarms. An optional
`expected_etag` prevents overwriting a newer server version.

### `delete_event`

Deletes an event or complete recurring series, optionally requiring an observed ETag.
Deleting a single expanded occurrence is not supported in the current release.

## Tech stack

- [Node.js 24+](https://nodejs.org/)
- [TypeScript](https://www.typescriptlang.org/) with strict project rules
- [Model Context Protocol TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [tsdav](https://github.com/natelindev/tsdav)
- [ical.js](https://github.com/kewisch/ical.js)
- [Zod](https://zod.dev/)
- [Vitest](https://vitest.dev/)
- [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/)

## Installation

### Prerequisites

- An iCloud account with Calendar enabled.
- Two-factor authentication enabled for the Apple Account.
- An [app-specific password](https://support.apple.com/en-us/102654).
- Docker and Docker Compose for container deployment, or Node.js 24+ and pnpm for a
  local installation.

### Docker Compose

The recommended installation uses the published multi-architecture image:

```text
ghcr.io/lukegskw/caldav-mcp:latest
```

Download the Compose example:

```sh
curl -O https://raw.githubusercontent.com/lukegskw/caldav-mcp/main/compose.example.yaml
```

Provide the Apple Account email and app-specific password, then start the service:

```sh
export CALDAV_USERNAME='user@example.com'
export CALDAV_PASSWORD='xxxx-xxxx-xxxx-xxxx'
docker compose -f compose.example.yaml up -d
```

To publish a different host port, set:

```sh
export CALDAV_MCP_PUBLISHED_PORT=18100
docker compose -f compose.example.yaml up -d
```

The `latest` tag follows the newest successful build from the default branch. For a
controlled deployment or rollback, replace it in the Compose file with a published
version or immutable `sha-*` tag.

The Streamable HTTP endpoint will be available at:

```text
http://<host>:8100/mcp
```

The host port can change without changing port `8100` inside the container. No
persistent volume is required; calendar data remains in iCloud.

### Docker run

The same hardened container configuration can be started directly:

```sh
docker run -d \
  --name caldav-mcp \
  --restart unless-stopped \
  --read-only \
  --user 10001:10001 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:size=16m,mode=1777 \
  -e CALDAV_PROVIDER=icloud \
  -e CALDAV_USERNAME \
  -e CALDAV_PASSWORD \
  -e CALDAV_MCP_TRANSPORT=streamable-http \
  -e CALDAV_MCP_HOST=0.0.0.0 \
  -p 8100:8100 \
  ghcr.io/lukegskw/caldav-mcp:latest
```

### Build the container from source

Building locally is optional. Prefer the published image unless you need to modify or
audit the container build.

```sh
git clone https://github.com/lukegskw/caldav-mcp.git
cd caldav-mcp
docker buildx build --load -t caldav-mcp:local .
```

### Local Node.js installation

```sh
git clone https://github.com/lukegskw/caldav-mcp.git
cd caldav-mcp
pnpm install --frozen-lockfile
cp .env.example .env
pnpm build
pnpm start -- --transport stdio
```

In `stdio` mode, stdout is reserved exclusively for MCP messages. To run Streamable HTTP
locally:

```sh
CALDAV_MCP_TRANSPORT=streamable-http pnpm start
```

## Configuration

All settings use the `CALDAV_` or `CALDAV_MCP_` prefix.

| Variable                        | Required | Default                     | Description                                       |
| ------------------------------- | -------- | --------------------------- | ------------------------------------------------- |
| `CALDAV_PROVIDER`               | No       | `icloud`                    | Provider policy. iCloud is the supported profile. |
| `CALDAV_URL`                    | No       | `https://caldav.icloud.com` | CalDAV discovery URL.                             |
| `CALDAV_USERNAME`               | Yes      | None                        | Apple Account email.                              |
| `CALDAV_PASSWORD`               | Yes      | None                        | App-specific password, not the account password.  |
| `CALDAV_MCP_TRANSPORT`          | No       | `stdio`                     | `stdio` or `streamable-http`.                     |
| `CALDAV_MCP_HOST`               | No       | `0.0.0.0`                   | HTTP bind address.                                |
| `CALDAV_MCP_PORT`               | No       | `8100`                      | HTTP listening port.                              |
| `CALDAV_MCP_LOG_LEVEL`          | No       | `INFO`                      | Application log level.                            |
| `CALDAV_MCP_REQUEST_TIMEOUT_MS` | No       | `30000`                     | CalDAV request timeout.                           |

The core retains an experimental `generic` provider policy and configurable URL to keep
Apple extensions isolated from the shared iCalendar implementation. No compatibility
with other providers is currently claimed.

Secrets must be supplied through the deployment platform or environment. Never commit
`.env`, pass credentials as MCP tool arguments, or include them in diagnostic reports.

## MCP client setup

For any MCP client that accepts Streamable HTTP server definitions, configure the URL:

```yaml
mcp_servers:
  caldav:
    url: http://<host>:8100/mcp
```

If the client shares the Compose network, use the service name and internal port:

```yaml
mcp_servers:
  caldav:
    url: http://caldav-mcp:8100/mcp
```

For clients that launch local `stdio` servers, configure the command to run
`node /absolute/path/to/caldav-mcp/dist/main.js` with the required environment
variables.

Configuration formats differ between MCP clients. Consult the client's documentation
for its exact schema and reload or restart it after changing the server definition.

## Verification

Check the container state and logs:

```sh
docker compose -f compose.example.yaml ps
docker compose -f compose.example.yaml logs caldav-mcp
```

The container should report `healthy`. The TCP healthcheck validates the server process,
not iCloud credentials.

Run the repository verification suite:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
```

Finally, connect with an MCP client and confirm that all six tools are listed. Before a
release, run the dedicated [iCloud manual validation](docs/icloud-manual-test.md) against
a test calendar.

## Limitations

- One iCloud account is configured per server process or container.
- The Streamable HTTP endpoint has no authentication in the current release. Restrict it
  to a trusted LAN, VPN, or private container network; do not expose it directly to the
  internet.
- Individual recurrence occurrences are read-only. Updating or deleting the complete
  series is supported.
- Only `ACTION:DISPLAY` alarms are created.
- Individual iCalendar resources are limited to 5 MiB.
- Event list ranges are limited to 366 days and pages to 500 results.
- Events may contain at most 20 alarms.
- Attendee scheduling is outside the current scope.
- Providers other than iCloud are not officially supported.

See [troubleshooting](docs/troubleshooting.md) for discovery, authentication, ETag, and
Apple extension guidance. Review [SECURITY.md](SECURITY.md) before reporting a security
issue or attaching diagnostics.

## Contributing

Contributions are welcome. Before opening a pull request:

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker buildx build --load -t caldav-mcp:test .
```

Changes to CalDAV writes or iCalendar serialization must preserve ETag checks, opaque
resource boundaries, unknown properties, recurrence exceptions, and alarms omitted from
patches. TypeScript changes must continue to satisfy the rules in
[`.codex/rules/typescript.md`](.codex/rules/typescript.md).

## License

MIT. See [LICENSE](LICENSE).
