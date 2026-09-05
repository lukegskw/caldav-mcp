# Container release strategy

## Understanding

- Pull requests and changes on `main` must validate the application and Dockerfile.
- CI validation must not publish development images to GHCR.
- Stable releases publish one multi-platform image for AMD64 and ARM64.
- `latest` identifies the newest stable release, not the newest commit on `main`.
- Exact version tags remain immutable deployment references.
- Existing GHCR manifests and attestations are outside the scope of this change.

## Assumptions

- Releases continue to start when a new synchronized package version reaches `main`.
- Prerelease versions contain a hyphen according to semantic versioning.
- Consumers that need reproducibility use an exact version or digest.
- There is no current requirement for continuously published development images.

## Decision log

1. Keep application checks and a native AMD64 container build on pull requests and
   `main`. This catches Dockerfile regressions without writing to the registry or
   paying the cost of emulating ARM64 during every CI run.
2. Keep publication in the existing release workflow so npm, GHCR, MCP Registry, and
   GitHub releases remain coordinated and resumable.
3. Publish stable releases with exact, minor-series, and `latest` tags on the same
   multi-platform manifest. Prereleases receive only their exact tag so they cannot
   replace stable aliases.
4. Generate maximum provenance and an SBOM for published images. These attestations
   remain attached to the release manifest and may appear as untagged child manifests
   in the GHCR interface.
5. Grant registry and identity write permissions only to the release publication job.

## Final design

The container CI workflow runs quality checks and builds `linux/amd64` with Buildx and
the GitHub Actions cache. It explicitly disables pushing and has read-only repository
permissions.

The release workflow detects a new synchronized semantic version on `main`, validates
the full distribution, and builds the container once for `linux/amd64` and
`linux/arm64`. A stable `0.1.6` release publishes `0.1.6`, `0.1`, and `latest` against
the same manifest. A prerelease such as `0.2.0-beta.1` publishes only that exact tag.
If a release resumes after the exact image already exists, the workflow restores the
stable aliases without rebuilding the image.
