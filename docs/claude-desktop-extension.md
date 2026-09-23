# Claude Desktop extension (MCP Bundle)

The server ships as an [MCP Bundle](https://github.com/modelcontextprotocol/mcpb)
(`.mcpb`): a ZIP archive that holds the compiled server, its production dependencies,
and a [`manifest.json`](../manifest.json) describing how to launch it and which settings
to ask the user for. Claude Desktop for macOS and Windows installs a bundle with one
click and runs it with its built-in Node.js, so users do not need to install Node.js,
edit JSON, or handle `npx`.

## Installing (users)

1. Create an [Apple app-specific password](https://support.apple.com/en-us/102654).
2. Download
   [`caldav-mcp.mcpb`](https://github.com/lukegskw/caldav-mcp/releases/latest/download/caldav-mcp.mcpb)
   from the latest release.
3. Open the file with Claude Desktop (double-click it, or drag it onto
   **Settings -> Extensions**) and choose **Install**.
4. Enter the Apple Account email and the app-specific password. Claude Desktop stores
   the password as a sensitive setting.
5. Enable the extension and confirm that the six calendar tools are listed.

To upgrade, install the `.mcpb` of the newer release in the same way.

## Bundle contents

| Path             | Source                                                               |
| ---------------- | -------------------------------------------------------------------- |
| `manifest.json`  | [`manifest.json`](../manifest.json) (MCPB manifest version 0.3)      |
| `dist/`          | `pnpm build` output, without declaration and source map files        |
| `node_modules/`  | Production dependencies installed from `pnpm-lock.yaml`              |
| `package.json`   | Reduced copy with name, version, `type`, `engines`, and dependencies |
| License, privacy | `LICENSE`, `PRIVACY.md`, and `README.md`                             |

[`scripts/build-mcpb.mjs`](../scripts/build-mcpb.mjs) stages the bundle in a temporary
directory outside the repository, so a dependency missing from the bundle cannot be
resolved from the repository's own `node_modules`. It installs production dependencies
with `--frozen-lockfile` and pnpm's hoisted linker, which produces a flat `node_modules`
without symlinks that works after extraction on every platform. It then runs
`mcpb validate` and `mcpb pack` using the version of
[`@anthropic-ai/mcpb`](https://www.npmjs.com/package/@anthropic-ai/mcpb) pinned in
`package.json`.

## Building and testing locally

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm build:mcpb
pnpm test:mcpb
```

`pnpm build:mcpb` writes `build/caldav-mcp.mcpb` and prints its SHA-256 digest.
`pnpm test:mcpb` unpacks that file into a temporary directory, launches the server
exactly as `manifest.json` instructs (with placeholder credentials), and checks that
the server version matches `package.json` and that the tools the server lists match the
`tools` array in the manifest.

Before a release that changes the bundle, install `build/caldav-mcp.mcpb` in Claude
Desktop and exercise the tools against a test calendar. Claude Desktop writes server
logs to `mcp-server-<name>.log` in its `logs` directory.

## Shipping a release

The bundle is part of the regular automated release; no separate step is required.

1. `pnpm release:prepare X.Y.Z` updates the version in `manifest.json` together with
   `package.json`, `server.json`, and `gemini-extension.json`.
2. `pnpm test:distribution` fails if those versions differ, if the bundle entry point
   differs from the npm `bin`, if `compatibility.runtimes.node` differs from
   `engines.node`, or if the password setting is not sensitive.
3. After the release commit reaches `main`, the
   [publish workflow](../.github/workflows/publish.yml) builds the bundle, runs
   `pnpm test:mcpb`, creates the GitHub release, and attaches `caldav-mcp.mcpb` to it.
   A rerun keeps an already attached bundle instead of replacing it.
4. The stable download link
   `https://github.com/lukegskw/caldav-mcp/releases/latest/download/caldav-mcp.mcpb`
   always points to the newest stable release.

CI builds and smoke-tests the bundle on Node.js 22 and 24 for every pull request.

## Maintaining the manifest

- **Adding, renaming, or removing a tool:** update the `tools` array in
  `manifest.json`. `pnpm test:mcpb` fails when it differs from the server.
- **Changing the Node.js requirement:** update `engines.node` in `package.json` and
  `compatibility.runtimes.node` in `manifest.json` together. Claude Desktop runs the
  bundle with its built-in Node.js, so keep the minimum at an actively supported LTS
  line rather than the newest release.
- **Adding a setting:** add a `user_config` entry and map it to an environment variable
  in `server.mcp_config.env`. Mark secrets with `"sensitive": true`, and never pass
  secrets as command-line arguments.

## Optional follow-ups

- **Icon:** add a square PNG (for example 512x512) as `icon.png`, reference it with
  `"icon": "icon.png"` in `manifest.json`, and add it to the copied files in
  `scripts/build-mcpb.mjs`. Extension directories show it next to the name.
- **Signing:** `pnpm exec mcpb sign build/caldav-mcp.mcpb --cert cert.pem --key key.pem`
  signs the bundle with a code-signing certificate, and `mcpb verify` checks it. Signing
  must happen after `pnpm test:mcpb` and before the upload. Keep the key in a GitHub
  Actions secret, never in the repository. Unsigned bundles still install.
- **MCP Registry:** the registry accepts `registryType: "mcpb"` packages whose
  `identifier` is the release asset URL and whose `fileSha256` is the bundle digest.
  Because the digest is known only after the build, the publish workflow would have to
  add this entry to `server.json` before `mcp-publisher publish`.
- **Extension directory:** Anthropic reviews submissions to the Claude Desktop extension
  directory manually. Submit the released `.mcpb` through Anthropic's current
  submission process; the manifest already declares the project and Apple privacy
  policies.
