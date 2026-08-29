# Backend Runtime Artifact Contract

The installer consumes one verified `arc-backend-runtime-<platform>-<arch>-<version>.tar.gz`
archive. It extracts the archive without running pnpm, TypeScript, or dependency installation.

## Required Layout

```
node/                 Bundled target-specific Node 22 runtime
app/                  Compiled API and production dependencies
runtime-host/dist/      Compiled runtime host
runtime-host/services.json
runtime-manifest.json
LICENSES/
```

`runtime-manifest.json` has schema version 1, target platform and architecture, backend version,
API compatibility version, Node version, and SHA-256 hashes for every staged file. The installer
must reject an archive whose manifest hashes do not validate.

## Runtime Ownership

The installer replaces only the versioned runtime files during an upgrade. It starts the runtime host
for the installing user with `ARC_DATA_DIR` pointing to the stable per-user data root. It preserves
that data root on ordinary upgrade and uninstall.

The runtime host is started with the bundled Node executable and `runtime-host/dist/index.js`. It owns
the API child process. Clients do not start or stop the API.

## Client Contract

The API writes `<data-root>/runtime/endpoint.json` only after readiness:

```json
{"schemaVersion":1,"apiBaseUrl":"http://127.0.0.1:<port>"}
```

Clients read this file, call `GET /health/ready`, and reread it after a connection failure.
`GET /health/live` reports process liveness. Both endpoints are loopback-only. Logs are retained
at `<data-root>/logs/api.jsonl` and `<data-root>/logs/runtime-host.jsonl`.
