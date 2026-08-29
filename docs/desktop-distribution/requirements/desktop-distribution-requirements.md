# Desktop Distribution: Requirements

**Date:** 2026-08-27
**Status:** Frozen

---

## 1. Context

### 1.1 Problem statement

AudioReach Creator customers need one supported desktop installation that delivers the
Electron-based React frontend and the REST backend together. The backend is a shared,
single-user local service: the Electron application, MATLAB, and other local HTTP clients
must observe the same current workspace state. Closing any client must not stop the backend.

The existing development release archive is not sufficient for customers because it requires a
separately installed Node.js runtime, manual startup, and no lifecycle, readiness, or upgrade
contract.

### 1.2 What this builds on

- `@arc/api` is a single NestJS/Node.js process using embedded SQLite and automatic TypeORM
  migrations at startup.
- The current database-path helper already uses per-user operating-system data locations. Its
  planned `ConfigService` integration must retain those defaults while allowing configuration.
- The frontend is a separate Electron application containing the React UI.
- The backend has hexagonal/CQRS boundaries. Distribution, process lifecycle, and operating-system
  integration must stay outside `@arc/core`.

### 1.3 Decisions already made

- The first customer release is a local, single-user desktop product, not a network server.
- The product starts a per-user backend runtime host after the installing user logs in; it does not
  need to run before login or as a machine-wide system service.
- Electron may start an unavailable backend and wait for it to become ready, but must never stop it
  when its own window closes.
- Updates are downloaded and installed by rerunning a signed installer. In-product auto-updates are
  not required.
- Local access requires no token or credentials in the first release.

## 2. Definitions

| Term | Definition |
|---|---|
| Backend | The independently running AudioReach Creator NestJS/Node.js API process. |
| Client | Electron, MATLAB, or another program on the same computer that calls the Backend HTTP API. |
| Desktop distribution | The customer installer and installed frontend/backend artifacts for one operating-system user. |
| Per-user data directory | An operating-system application-data location owned by one logged-in user, separate from installed binaries. |
| Discovery record | A well-known, per-user file containing the active local API endpoint. |
| Ready | The backend is listening, its database directory and SQLite database are available, migrations have completed, and it can safely serve clients. |

## 3. Functional Requirements

### 3.1 Installation and supported platforms

#### FR-DD-01: Single signed customer installation

For each supported operating system, the product shall provide a signed, guided platform-native
installation that installs a compatible Electron frontend and backend together. Windows shall use
an installation wizard; macOS and Linux shall use their supported platform-native install flows.
The distribution shall bundle the required Node.js 22 runtime and backend production dependencies,
so customers do not need to install Node.js, pnpm, build tools, or backend dependencies.

If the installer cannot verify its package integrity or signature, it shall abort before installing
or replacing application binaries and explain the failure.

#### FR-DD-02: Per-user installation

The installer shall install and configure the product for the current OS user without requiring
administrator privileges in the normal path. It shall register the backend for automatic start
after that user's login.

If the current OS or organization policy prevents the required per-user startup registration, the
installer shall report that condition and leave the installed product launchable manually.

#### FR-DD-03: First-release platform matrix

The first customer release shall support:

- Windows 10 version 22H2 and Windows 11 on x64.
- Qualcomm Windows-on-ARM PCs through Windows x64 emulation, using the x64 product artifacts.
- macOS 13 (Ventura) or later on Intel x64 and Apple Silicon arm64.
- Ubuntu 22.04 LTS and 24.04 LTS on x64.

The product shall not claim support for arbitrary Linux distributions or native Windows arm64 in
this release.

### 3.2 Backend lifecycle and client coordination

#### FR-DD-04: Independent backend lifecycle

The backend shall run as a single, independent per-user process. It shall remain available when
any Electron, MATLAB, or other client exits. A client shall not issue a shutdown action or otherwise
terminate the backend as part of its own exit path.

If a second backend start is requested for the same user, the product shall detect the active
instance and use it rather than create a competing instance and SQLite writer.

#### FR-DD-05: Local service supervision and recovery

The product shall run an independent, per-user runtime host after user login. The runtime host shall
manage explicitly declared local services. Each service definition shall identify its launch command,
readiness health check, restart policy, dependencies, and diagnostic-log destination.

The first-release service manifest shall contain only the offline Backend API. The runtime host shall
start it, detect its process exit, poll its local readiness health check, and restart it after a
crash or sustained non-ready state. It shall use bounded restart backoff and record diagnostics for
repeated failures.

The operating system's per-user startup facility shall restart the runtime host if the runtime host
itself exits unexpectedly. No client may be the primary owner of backend recovery.

#### FR-DD-06: Client-assisted availability

The Electron client shall determine whether the backend is available before using the API. If it is
not available, Electron may request its startup, wait for readiness, and show a clear recoverable
error when it cannot become ready. This behavior shall not make Electron the owner of backend
shutdown or ongoing process lifetime.

#### FR-DD-07: Local-only network binding

The backend shall bind exclusively to loopback interfaces (`127.0.0.1` and, where supported,
`::1`). It shall not accept API connections from other computers on the LAN or any other network.

If the configured bind address is not loopback, the backend shall refuse to start and report a
safe configuration error.

#### FR-DD-08: Port selection and endpoint discovery

On first installation or when no usable endpoint configuration exists, the local backend shall
select an available loopback port. It shall publish its active API base address to a well-known
discovery record in the per-user data directory.

Electron and other supported local clients shall obtain the endpoint from that record rather than
assume a fixed port. If the recorded port is unavailable at startup, the backend shall choose an
available loopback port, update the record atomically, and only then advertise readiness. Clients
shall reread the record after a connection failure before reporting the backend unavailable.

The discovery record shall contain the endpoint only; it shall not contain an access token in the
first release.

### 3.3 Data, readiness, and observability

#### FR-DD-09: Per-user mutable data

The SQLite database, endpoint discovery record, user configuration, imported-file state, and logs
shall be stored in the per-user data directory, not alongside installed binaries. The backend shall
create the required parent directories before opening SQLite.

The database location shall retain its current OS-specific default and become configurable through
the backend configuration mechanism.

#### FR-DD-10: Readiness health check

The backend shall expose a local health/readiness check. It shall report ready only after the HTTP
server is accepting requests, database initialization is complete, all pending migrations have
completed, and the shared workspace state is safe for clients to use.

Before readiness, the check shall report an explicit non-ready state. Startup failure, migration
failure, or an inaccessible data directory shall result in a non-ready state and diagnostic logs.

#### FR-DD-11: Diagnostics

The backend shall retain startup, health, and crash diagnostics in the per-user data directory.
The Electron application shall provide a way to reveal or export those logs for customer support.

### 3.4 Upgrade and removal

#### FR-DD-12: Installer-driven upgrade

Customers shall upgrade by downloading and rerunning a signed installer. An upgrade shall replace
the installed frontend and backend binaries while preserving per-user database, imported-file state,
endpoint configuration, and logs. The upgraded backend shall apply its normal database migrations
before reporting ready.

If an upgrade cannot preserve or migrate user data safely, it shall stop and report the problem
without deleting that data.

#### FR-DD-13: Intentional data removal

Uninstall shall preserve per-user application data by default. It shall offer an explicit, clearly
labeled option to delete all AudioReach Creator user data. Selecting that option shall remove the
database, imported-file state, configuration, discovery record, and logs for that user.

### 3.5 Frontend/backend independence

#### FR-DD-14: Remote-ready client boundary

Electron's API connection logic shall be separate from its local-backend availability logic. Local
mode shall use the discovery record and may start the local backend; a future remote-server mode
shall be able to provide an API base address without requiring Electron to start or manage a local
backend.

The first release need not expose a remote-server setting to customers.

## 4. Invariants

**I1 - One backend per user:** At most one active backend instance may own a user's SQLite database
and discovery record at any time.

**I2 - No network exposure:** The first-release API is reachable only from the same computer through
loopback; it is never bound to a LAN or public network interface.

**I3 - Backend outlives clients:** Terminating any client cannot terminate the backend or erase shared
state used by other clients.

**I4 - Published endpoint is usable:** The discovery record is published or changed only after the
backend has bound the endpoint and is ready to accept clients.

**I5 - User data survives normal lifecycle operations:** An ordinary upgrade or uninstall preserves
per-user data unless the user explicitly selects data deletion during uninstall.

## 5. Non-Functional Requirements

**NFR-DD-01 - Distribution integrity:** Customer installers are code-signed and verification failure
prevents installation.

**NFR-DD-02 - Runtime compatibility:** Each release is validated on every operating-system and
architecture combination in FR-DD-03, including a Qualcomm Windows-on-ARM PC using x64 emulation.

**NFR-DD-03 - Customer usability:** Customer installation and ordinary startup require no command
line, developer tools, or separate Node.js installation.

**NFR-DD-04 - Backward-compatible deployment boundary:** Distribution, OS startup, and HTTP health
concerns remain in the API/desktop-adapter layers. `@arc/core` remains framework- and Node-free.

**NFR-DD-05 - Multi-service evolution:** The runtime host is extensible through declared local-service
definitions so future device or real-time Node.js services can be supervised without changing the
first-release Backend API's process contract.

## 6. Out of Scope

- A remotely reachable, multi-user server deployment.
- Network authentication, authorization, TLS, or tenant isolation.
- A customer-facing remote-server connection setting in Electron.
- In-product automatic download and installation of updates.
- Native Windows arm64 artifacts; Windows-on-ARM uses x64 emulation initially.
- Certification for Linux distributions other than the specified Ubuntu LTS releases.
- Implementation of future real-time device tuning or monitoring services. The first release only
  reserves the runtime host extension point for such services.
- Changing domain/CQRS behavior beyond the small API/bootstrap configuration and health needs of this
  distribution scope.

## 7. Open Questions

**OQ-1:** Which signing-certificate owners and release-signing process will be used for Windows,
macOS, and Linux distribution artifacts?

**OQ-2:** What artifact, versioning, and release contract will the separate Electron frontend
repository expose so the customer installer can assemble a tested compatible frontend/backend pair?

**OQ-3:** What customer-facing product name, identifiers, icons, and installer copy are required on
each operating system?
