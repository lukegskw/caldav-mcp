# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub Security Advisories for this
repository. Do not open a public issue containing credentials, Apple Account details,
CalDAV URLs, ETags, UIDs, event content, raw iCalendar data, HTTP headers, or container
logs that may include personal information.

Include a minimal reproduction with synthetic calendar data, the affected release or
image digest, deployment architecture, and the security impact. Replace all credentials
and identifiers before attaching diagnostics.

If a credential may have been disclosed, revoke the iCloud app-specific password
immediately, create a replacement, update the NAS secret, and restart the container.

## Deployment boundary

The Streamable HTTP endpoint does not authenticate clients in the current release. It
must be reachable only from a trusted LAN, VPN, or private container network. Do not
publish port `8100` to the public internet without an authenticated reverse proxy and an
explicit threat review.

The supported container runs as UID/GID `10001`, drops Linux capabilities, supports a
read-only root filesystem, and requires no persistent volume. These controls reduce
impact but do not replace network isolation or secret management.
