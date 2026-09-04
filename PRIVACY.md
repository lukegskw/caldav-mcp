# Privacy

CalDAV MCP runs locally on the user's machine or infrastructure. It connects directly
to the CalDAV service configured by the user and does not send calendar data or
credentials to the project author.

The server has no telemetry, analytics, advertising, or application database. Calendar
resources and credentials are processed in memory only. Diagnostic logs redact
credentials, raw calendar content, and CalDAV paths.

When iCloud is used, Apple processes account and calendar data under
[Apple's Privacy Policy](https://www.apple.com/legal/privacy/). Installation platforms,
package registries, container registries, and MCP clients may independently collect
operational data under their own policies.

Use an Apple app-specific password rather than the Apple Account password. Keep MCP
configuration files and environment variables private. Report security concerns as
described in [SECURITY.md](SECURITY.md).
