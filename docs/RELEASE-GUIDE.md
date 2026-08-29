# Release Guide

Desktop backend releases are produced as target-specific runtime artifacts. The installer consumes
these artifacts unchanged and remains responsible for product signing, OS startup registration,
and Electron packaging.

The `Backend Runtime Release` workflow builds and verifies artifacts for Windows x64, macOS x64,
macOS arm64, and Ubuntu x64. Each job installs Node 22, builds the workspaces, stages production
dependencies, bundles the matching Node runtime, validates the runtime manifest, performs the
runtime smoke check, and uploads a `.tar.gz` artifact.

For a local target-compatible build, provide a downloaded Node 22 runtime directory:

```bash
pnpm package:runtime <platform> <arch> <node-runtime-directory> <output-directory>
```

The command produces `arc-backend-runtime-<platform>-<arch>-<version>.tar.gz`. Validate an
extracted runtime with:

```bash
pnpm verify:runtime <runtime-root>
```

Installer ownership and the public runtime contract are documented in
`docs/desktop-distribution/backend-runtime-artifact-contract.md`.
