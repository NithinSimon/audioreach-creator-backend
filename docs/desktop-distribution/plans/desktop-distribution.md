# Desktop Distribution Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make the backend a self-contained, per-user local desktop runtime that an installer can start, monitor, update, and connect clients to without monorepo tooling.

**Architecture:** Add desktop runtime services to @arc/api for data-root configuration, loopback binding, readiness, endpoint discovery, logging, and shutdown. Add @arc/runtime-host for one-per-user process recovery. Package the compiled API, production dependencies, bundled Node 22, and runtime host as a target-specific artifact. Do not modify @arc/core.

**Tech Stack:** TypeScript ESM/NodeNext, NestJS 11, TypeORM/SQLite, Node.js 22, pnpm 10, Jest/ts-jest, Node built-in child_process/fs/http APIs, GitHub Actions.

---

## File Structure

| Path | Responsibility |
|---|---|
| packages/api/src/infrastructure-wrapper/runtime/runtime-config.ts | Validate runtime env and preserve development port behavior. |
| packages/api/src/infrastructure-wrapper/runtime/runtime-paths.ts | Resolve/create per-user data, runtime, and log paths. |
| packages/api/src/infrastructure-wrapper/runtime/readiness-state.service.ts | Runtime state used by health and request gating. |
| packages/api/src/infrastructure-wrapper/runtime/endpoint-discovery.service.ts | Atomically publish/remove endpoint.json. |
| packages/api/src/infrastructure-wrapper/runtime/runtime-initializer.service.ts | Initialize SQLite/migrations after health is reachable. |
| packages/api/src/infrastructure-wrapper/runtime/runtime-shutdown.service.ts | Signal-driven resource cleanup. |
| packages/api/src/presentation/rest/modules/health/* | Local liveness/readiness API. |
| packages/runtime-host/* | Service manifest, lock, health polling, child lifecycle, diagnostics. |
| scripts/package-backend-runtime.mjs | Assemble production runtime folder and archive. |
| scripts/verify-backend-runtime.mjs | Launch staged payload with bundled Node and verify public contract. |
| .github/workflows/runtime-release.yml | Publish target-specific runtime archives. |

### Task 1: Add API Runtime Configuration and Paths

**Package:** @arc/api

**Files:**
- Create: packages/api/src/infrastructure-wrapper/runtime/runtime-config.ts
- Create: packages/api/src/infrastructure-wrapper/runtime/runtime-paths.ts
- Create: packages/api/tests/unit/infrastructure-wrapper/runtime/runtime-config.spec.ts
- Create: packages/api/tests/unit/infrastructure-wrapper/runtime/runtime-paths.spec.ts
- Modify: packages/api/src/infrastructure-wrapper/database/database-path.ts
- Modify: packages/api/src/app.module.ts

- [ ] **Step 1: Write failing tests for loopback validation and directory creation**

    describe('resolveRuntimeConfig', () => {
      it('rejects a non-loopback bind host', () => {
        expect(() =>
          resolveRuntimeConfig({
            ARC_BIND_HOST: '192.168.1.20',
            ARC_DATA_DIR: '/tmp/arc-data',
          }),
        ).toThrow('ARC_BIND_HOST must be a loopback address');
      });

      it('uses port zero only in desktop runtime mode', () => {
        expect(
          resolveRuntimeConfig({
            ARC_RUNTIME_MODE: 'desktop',
            ARC_DATA_DIR: '/tmp/arc-data',
          }).requestedPort,
        ).toBe(0);
        expect(resolveRuntimeConfig({PORT: '4100'}).requestedPort).toBe(4100);
      });
    });

    it('creates the runtime and log directories before SQLite is opened', async () => {
      const paths = new RuntimePaths(join(testRoot, 'nested', 'data'));
      await paths.ensureDirectories();

      await expect(stat(paths.runtimeDir)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
      await expect(stat(paths.logsDir)).resolves.toMatchObject({
        isDirectory: expect.any(Function),
      });
    });

- [ ] **Step 2: Run tests to verify they fail**

Run: pnpm --filter @arc/api run test:unit -- --testPathPattern="runtime-config|runtime-paths"

Expected: FAIL because the runtime modules do not exist.

- [ ] **Step 3: Implement config parsing and paths**

    export type RuntimeConfig = Readonly<{
      mode: 'development' | 'desktop';
      dataDir: string;
      bindHost: '127.0.0.1' | '::1';
      requestedPort: number;
      serviceId: string;
    }>;

    export function resolveRuntimeConfig(
      environment: NodeJS.ProcessEnv = process.env,
    ): RuntimeConfig {
      const mode = environment.ARC_RUNTIME_MODE === 'desktop' ? 'desktop' : 'development';
      const bindHost = environment.ARC_BIND_HOST ?? '127.0.0.1';
      if (bindHost !== '127.0.0.1' && bindHost !== '::1') {
        throw new Error('ARC_BIND_HOST must be a loopback address');
      }
      const requestedPort = Number(
        environment.ARC_PORT ?? (mode === 'desktop' ? '0' : environment.PORT ?? '3000'),
      );
      if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
        throw new Error('ARC_PORT must be an integer from 0 through 65535');
      }
      return {mode, dataDir: resolveDefaultDataDir(environment), bindHost, requestedPort,
        serviceId: environment.ARC_SERVICE_ID ?? 'offline-api'};
    }

    export class RuntimePaths {
      constructor(readonly dataDir: string) {}
      get databasePath(): string { return path.join(this.dataDir, 'database.db'); }
      get runtimeDir(): string { return path.join(this.dataDir, 'runtime'); }
      get endpointPath(): string { return path.join(this.runtimeDir, 'endpoint.json'); }
      get logsDir(): string { return path.join(this.dataDir, 'logs'); }
      async ensureDirectories(): Promise<void> {
        await Promise.all([fs.mkdir(this.dataDir, {recursive: true}),
          fs.mkdir(this.runtimeDir, {recursive: true}), fs.mkdir(this.logsDir, {recursive: true})]);
      }
    }

    // Register RuntimeConfig and RuntimePaths through AppModule. database-path.ts must delegate to
    // RuntimePaths.databasePath instead of directly reading os.homedir().

- [ ] **Step 4: Run focused tests and build**

Run: pnpm --filter @arc/api run test:unit -- --testPathPattern="runtime-config|runtime-paths"

Expected: PASS

Run: pnpm --filter @arc/api run build

Expected: PASS

### Task 2: Add Readiness State and Atomic Endpoint Discovery

**Package:** @arc/api

**Files:**
- Create: packages/api/src/infrastructure-wrapper/runtime/readiness-state.service.ts
- Create: packages/api/src/infrastructure-wrapper/runtime/endpoint-discovery.service.ts
- Create: packages/api/tests/unit/infrastructure-wrapper/runtime/readiness-state.spec.ts
- Create: packages/api/tests/unit/infrastructure-wrapper/runtime/endpoint-discovery.spec.ts
- Modify: packages/api/src/app.module.ts

- [ ] **Step 1: Write failing readiness/discovery tests**

    it('refuses endpoint publication before readiness and writes complete JSON after readiness', async () => {
      const readiness = new ReadinessStateService();
      const discovery = new EndpointDiscoveryService(paths, readiness);

      await expect(discovery.publish('http://127.0.0.1:43123')).rejects.toThrow(
        'Cannot publish endpoint before runtime is ready',
      );

      readiness.markReady();
      await discovery.publish('http://127.0.0.1:43123');

      await expect(readFile(paths.endpointPath, 'utf8')).resolves.toBe(
        '{"schemaVersion":1,"apiBaseUrl":"http://127.0.0.1:43123"}\n',
      );
    });

    it('does not remove a newer endpoint during older process shutdown', async () => {
      await writeFile(paths.endpointPath, '{"schemaVersion":1,"apiBaseUrl":"http://127.0.0.1:49000"}\n');
      await discovery.removeIfMatches('http://127.0.0.1:43123');
      await expect(readFile(paths.endpointPath, 'utf8')).resolves.toContain('49000');
    });

- [ ] **Step 2: Run tests to verify they fail**

Run: pnpm --filter @arc/api run test:unit -- --testPathPattern="readiness-state|endpoint-discovery"

Expected: FAIL because no runtime state or discovery writer exists.

- [ ] **Step 3: Implement the lifecycle state machine and atomic writer**

    export type ReadinessStatus = 'starting' | 'ready' | 'failed' | 'shutting_down';

    @Injectable()
    export class ReadinessStateService {
      private status: ReadinessStatus = 'starting';
      current(): ReadinessStatus { return this.status; }
      isReady(): boolean { return this.status === 'ready'; }
      markReady(): void { this.status = 'ready'; }
      markFailed(): void { this.status = 'failed'; }
      markShuttingDown(): void { this.status = 'shutting_down'; }
    }

    export type EndpointRecord = Readonly<{schemaVersion: 1; apiBaseUrl: string}>;

    // publish() validates readiness, writes compact JSON to a same-directory temporary file, fsyncs
    // it, and renames it to endpoint.json. removeIfMatches() deletes only a matching apiBaseUrl.

- [ ] **Step 4: Run focused tests and build**

Run: pnpm --filter @arc/api run test:unit -- --testPathPattern="readiness-state|endpoint-discovery"

Expected: PASS

Run: pnpm --filter @arc/api run build

Expected: PASS

### Task 3: Add Health Endpoints and Controlled API Initialization

**Package:** @arc/api

**Files:**
- Create: packages/api/src/presentation/rest/modules/health/health.controller.ts
- Create: packages/api/src/presentation/rest/modules/health/health.module.ts
- Create: packages/api/src/infrastructure-wrapper/runtime/readiness.middleware.ts
- Create: packages/api/src/infrastructure-wrapper/runtime/runtime-initializer.service.ts
- Create: packages/api/tests/e2e/health/health.e2e-spec.ts
- Modify: packages/api/src/app.module.ts
- Modify: packages/api/src/main.ts
- Modify: packages/api/src/infrastructure-wrapper/database/providers/data-source-provider.ts
- Modify: packages/api/src/infrastructure-wrapper/arc-cqrs.module.ts
- Modify: packages/api/tests/e2e/helpers/test-app.factory.ts

- [ ] **Step 1: Write failing health E2E tests**

    describe('runtime health', () => {
      it('returns 503 before database initialization completes', async () => {
        const response = await request(app.getHttpServer()).get('/health/ready');
        expect(response.status).toBe(503);
        expect(response.body).toEqual({status: 'starting'});
      });

      it('returns 200 after RuntimeInitializerService completes', async () => {
        await app.get(RuntimeInitializerService).initialize();
        await request(app.getHttpServer()).get('/health/ready')
          .expect(200)
          .expect({status: 'ready'});
      });

      it('gates non-health routes while not ready', async () => {
        await request(app.getHttpServer()).get('/arc-api/v1/projects')
          .expect(503)
          .expect({statusCode: 503, code: 'ARC_RUNTIME_NOT_READY'});
      });
    });

- [ ] **Step 2: Run test to verify it fails**

Run: pnpm --filter @arc/api run test:e2e -- --testPathPattern="health.e2e-spec.ts"

Expected: FAIL because health, gating, and deferred initialization are absent.

- [ ] **Step 3: Implement controller, middleware, and bootstrap skeleton**

    @Controller('health')
    export class HealthController {
      constructor(private readonly readiness: ReadinessStateService) {}

      @Get('live')
      live(@Res() response: Response): void {
        const status = this.readiness.current();
        response.status(status === 'shutting_down' ? 503 : 200).json({status});
      }

      @Get('ready')
      ready(@Res() response: Response): void {
        const status = this.readiness.current();
        response.status(status === 'ready' ? 200 : 503).json({status});
      }
    }

    @Injectable()
    export class RuntimeInitializerService {
      // Constructor dependencies: RuntimePaths, DataSourceProvider, ReadinessStateService,
      // EndpointDiscoveryService, and RUNTIME_BASE_URL.
      async initialize(): Promise<void> {
        // 1. Ensure runtime paths.
        // 2. Explicitly initialize DataSourceProvider and run migrations.
        // 3. Mark readiness ready and atomically publish RUNTIME_BASE_URL.
        // 4. Mark failed and rethrow on any error.
      }
    }

    // Remove eager OnModuleInit work from DataSourceProvider. Retain getDataSource() as a lazy
    // compatibility method. In main.ts, listen on RuntimeConfig.bindHost/requestedPort first,
    // derive the actual assigned port, bind RUNTIME_BASE_URL, then initialize runtime. Middleware
    // bypasses /health/* and returns the documented 503 response for all other routes until ready.

- [ ] **Step 4: Run health tests and existing E2E suite**

Run: pnpm --filter @arc/api run test:e2e -- --testPathPattern="health.e2e-spec.ts"

Expected: PASS

Run: pnpm --filter @arc/api run test:e2e

Expected: PASS

### Task 4: Move Logs to the Data Root and Add Graceful Shutdown

**Package:** @arc/api

**Files:**
- Create: packages/api/src/infrastructure-wrapper/runtime/runtime-shutdown.service.ts
- Create: packages/api/tests/unit/infrastructure-wrapper/runtime/runtime-shutdown.spec.ts
- Create: packages/api/tests/integration/runtime/graceful-shutdown.spec.ts
- Modify: packages/api/src/infrastructure-wrapper/logger/console-logger.service.ts
- Modify: packages/api/src/infrastructure-wrapper/arc-cqrs.module.ts
- Modify: packages/api/src/main.ts

- [ ] **Step 1: Write failing shutdown/log tests**

    it('marks shutdown, removes its endpoint, closes app resources, then destroys SQLite', async () => {
      const calls: string[] = [];
      const service = makeShutdownService(calls);

      await service.shutdown('http://127.0.0.1:43123');

      expect(calls).toEqual(['state', 'endpoint', 'app', 'database']);
    });

    it('places API logs under RuntimePaths.logsDir', () => {
      const logger = new ConsoleLoggerService(new RuntimePaths('/tmp/arc-runtime'));
      expect(logger.logFilePath()).toContain('/tmp/arc-runtime/logs/');
    });

- [ ] **Step 2: Run tests to verify they fail**

Run: pnpm --filter @arc/api run test:unit -- --testPathPattern="runtime-shutdown"

Expected: FAIL because shutdown coordination and injected log paths are absent.

- [ ] **Step 3: Implement shutdown and JSON-line file logging**

    @Injectable()
    export class RuntimeShutdownService {
      private stopping = false;

      async shutdown(baseUrl: string): Promise<void> {
        // 1. Return immediately when already stopping.
        // 2. Mark ReadinessStateService shutting_down.
        // 3. Remove only the matching endpoint record.
        // 4. Stop the Nest application from accepting work.
        // 5. Destroy the initialized DataSourceProvider connection and close log streams.
      }
    }

    // Inject RuntimePaths into ConsoleLoggerService, create logsDir before the stream, and emit one
    // JSON line containing msg, action, component, tag, timestamp, and serialized Error fields.
    // main.ts registers SIGTERM/SIGINT handlers through RuntimeShutdownService. Normal shutdown exits
    // zero; failed initialization exits nonzero.

- [ ] **Step 4: Run tests and build**

Run: pnpm --filter @arc/api run test:unit -- --testPathPattern="runtime-shutdown"

Expected: PASS

Run: pnpm --filter @arc/api run test:integration -- --testPathPattern="graceful-shutdown"

Expected: PASS

Run: pnpm --filter @arc/api run build

Expected: PASS

### Commit: API Desktop Runtime Contract

Use the commit skill to draft the commit message and wait for explicit approval:

    git add packages/api/src packages/api/tests package.json
    git commit -m "feat(api): add desktop runtime contract" -m "Prepare the API for supervised local startup with readiness, endpoint discovery, data-root logs, and graceful shutdown." -m "Signed-off-by: Name <email>"

STOP - do not run git commit until the user explicitly approves the message.

### Task 5: Create the runtime host Package

**Package:** @arc/runtime-host

**Files:**
- Create: packages/runtime-host/package.json
- Create: packages/runtime-host/tsconfig.json
- Create: packages/runtime-host/jest.config.mjs
- Create: packages/runtime-host/src/index.ts
- Create: packages/runtime-host/src/service-manifest.ts
- Create: packages/runtime-host/src/runtime-lock.ts
- Create: packages/runtime-host/src/health-client.ts
- Create: packages/runtime-host/src/runtime-host.ts
- Create: packages/runtime-host/src/runtime-host-logger.ts
- Create: packages/runtime-host/tests/unit/service-manifest.spec.ts
- Create: packages/runtime-host/tests/unit/runtime-lock.spec.ts
- Create: packages/runtime-host/tests/unit/health-client.spec.ts
- Create: packages/runtime-host/tests/integration/runtime-host-process.spec.ts
- Create: packages/runtime-host/tests/integration/fixtures/fixture-api.mjs
- Modify: package.json

- [ ] **Step 1: Write failing manifest, lock, and process-recovery tests**

    it('rejects a service without command and readinessPath', () => {
      expect(() => parseServiceManifest({schemaVersion: 1, services: [{id: 'offline-api'}]}))
        .toThrow('Service offline-api must define command and readinessPath');
    });

    it('does not acquire a second lock while the first owner is active', async () => {
      const first = await RuntimeLock.acquire(lockDirectory);
      await expect(RuntimeLock.acquire(lockDirectory)).rejects.toThrow(
        'Runtime runtime host is already running',
      );
      await first.release();
    });

    it('restarts a fixture that exits once and then becomes ready', async () => {
      const runtimeHost = createFixtureRuntimeHost({fixtureMode: 'crash-once-then-ready'});
      await runtimeHost.ensureRunning();
      expect(runtimeHost.restartCount()).toBe(1);
      await expect(runtimeHost.currentHealth()).resolves.toBe(true);
    });

- [ ] **Step 2: Run tests to verify they fail**

Run: pnpm --filter @arc/runtime-host run test

Expected: FAIL because the runtime host package does not exist.

- [ ] **Step 3: Implement the runtime host skeleton**

    export type ServiceDefinition = Readonly<{
      id: string;
      command: string;
      arguments: readonly string[];
      readinessPath: '/health/ready';
      dependsOn: readonly string[];
    }>;

    export class RuntimeHost {
      // Constructor dependencies: validated services, RuntimeLock, HealthClient, RuntimeHostLogger,
      // child spawner, and injected clock/timers.
      async ensureRunning(): Promise<void> {
        // 1. Acquire atomic directory lock; when locked, probe endpoint.json and return only if ready.
        // 2. Topologically order services and reject cycles/unknown dependencies.
        // 3. Spawn each child with ARC_RUNTIME_MODE=desktop and ARC_DATA_DIR.
        // 4. Wait for endpoint publication and health 200 until finite startup timeout.
        // 5. On failure, clean stale endpoint state, log attempt, and retry with bounded exponential backoff.
      }

      async monitor(): Promise<void> {
        // Poll readiness; on child exit or consecutive non-ready threshold, terminate the unhealthy
        // child, wait for exit, and restart only it plus declared dependents.
      }

      async stop(): Promise<void> {
        // Stop children in reverse dependency order, wait for bounded graceful exit, force-kill only
        // survivors, release lock, and close runtime host logs.
      }
    }

    // RuntimeLock uses fs.mkdir with recursive false and removes only its own owner metadata.
    // HealthClient classifies only HTTP 200 as ready; network errors and HTTP 503 are non-ready.
    // RuntimeHostLogger writes JSON lines to <data-root>/logs/runtime-host.jsonl.

- [ ] **Step 4: Run runtime host tests and build**

Run: pnpm --filter @arc/runtime-host run test

Expected: PASS

Run: pnpm --filter @arc/runtime-host run build

Expected: PASS

### Task 6: Package and Verify Target-Specific Backend Runtime Artifacts

**Package:** workspace tooling

**Files:**
- Create: scripts/package-backend-runtime.mjs
- Create: scripts/verify-backend-runtime.mjs
- Create: scripts/lib/runtime-manifest.mjs
- Create: scripts/tests/runtime-manifest.spec.mjs
- Create: scripts/tests/package-backend-runtime.spec.mjs
- Modify: package.json
- Modify: packages/api/package.json
- Modify: packages/runtime-host/package.json

- [ ] **Step 1: Write failing manifest/staging tests**

    test('manifest verification detects a modified staged file', async () => {
      const manifest = await createRuntimeManifest(stagingDirectory, metadata);
      await writeFile(join(stagingDirectory, 'runtime host', 'services.json'), '{}');

      await expect(verifyRuntimeManifest(stagingDirectory, manifest)).rejects.toThrow(
        'Runtime manifest hash mismatch',
      );
    });

    test('packaging rejects a Node runtime for a different platform', async () => {
      await expect(packageBackendRuntime({
        targetPlatform: 'win32',
        targetArch: 'x64',
        nodeRuntimeDir: linuxNodeDirectory,
      })).rejects.toThrow('Node runtime platform does not match win32-x64');
    });

- [ ] **Step 2: Run tests to verify they fail**

Run: node --test scripts/tests/runtime-manifest.spec.mjs scripts/tests/package-backend-runtime.spec.mjs

Expected: FAIL because runtime packaging modules do not exist.

- [ ] **Step 3: Implement staging and verifier scripts**

    export async function createRuntimeManifest(runtimeRoot, metadata) {
      const files = await listRuntimeFiles(runtimeRoot, ['runtime-manifest.json']);
      return {
        schemaVersion: 1,
        ...metadata,
        files: await Promise.all(files.sort().map(async relativePath => ({
          path: relativePath,
          sha256: await sha256File(join(runtimeRoot, relativePath)),
        }))),
      };
    }

    // package-backend-runtime.mjs accepts target platform, target arch, Node runtime directory, and
    // output directory. It builds workspaces, uses pnpm --filter @arc/api deploy --prod to stage
    // production modules, copies Node 22, runtime host dist/services.json/license notices, writes a
    // deterministic manifest, calls the verifier, then archives the output.
    //
    // verify-backend-runtime.mjs validates hashes, starts the staged runtime host with fresh temporary
    // ARC_DATA_DIR and ARC_PORT=0, waits for endpoint.json, requires a 127.0.0.1 URL and health 200,
    // sends normal termination, and requires endpoint cleanup.

- [ ] **Step 4: Run script tests and build**

Run: node --test scripts/tests/runtime-manifest.spec.mjs scripts/tests/package-backend-runtime.spec.mjs

Expected: PASS

Run: pnpm run build

Expected: PASS

### Commit: Runtime Host and Runtime Artifact

Use the commit skill to draft the commit message and wait for explicit approval:

    git add packages/runtime-host scripts package.json packages/api/package.json
    git commit -m "build(workspace): package desktop backend runtime" -m "Produce a verified Node runtime artifact that installers can deploy without pnpm or source code." -m "Signed-off-by: Name <email>"

STOP - do not run git commit until the user explicitly approves the message.

### Task 7: Add Release CI, Artifact Contract, and Final Acceptance Coverage

**Package:** workspace CI and documentation

**Files:**
- Create: .github/workflows/runtime-release.yml
- Modify: .github/workflows/ci-cd.yml
- Modify: docs/RELEASE-GUIDE.md
- Create: docs/desktop-distribution/backend-runtime-artifact-contract.md
- Create: packages/runtime-host/tests/integration/runtime-artifact.spec.ts
- Modify: scripts/verify-backend-runtime.mjs

- [ ] **Step 1: Write failing staged-runtime acceptance test**

    it('publishes a loopback endpoint and recovers after API child crash', async () => {
      const runtime = await stageRuntimeForTest();
      const runtimeHost = await startRuntimeHost(runtime);
      const endpoint = await waitForReadyEndpoint(runtime.dataDir);

      expect(endpoint.apiBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      await runtimeHost.killChild('offline-api');

      const recovered = await waitForReadyEndpoint(runtime.dataDir);
      expect(recovered.apiBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      await runtimeHost.stop();
    });

- [ ] **Step 2: Verify the existing CI mismatch**

Run: rg -n "node-version: '20'" .github/workflows/ci-cd.yml

Expected: one match, proving current CI does not meet the Node 22 product requirement.

- [ ] **Step 3: Implement release matrix and installer-facing contract**

    name: Backend Runtime Release

    jobs:
      build-runtime:
        strategy:
          matrix:
            include:
              - runner: windows-2022
                platform: win32
                arch: x64
              - runner: macos-13
                platform: darwin
                arch: x64
              - runner: macos-14
                platform: darwin
                arch: arm64
              - runner: ubuntu-22.04
                platform: linux
                arch: x64
              - runner: ubuntu-24.04
                platform: linux
                arch: x64

    // Every matrix job installs Node 22 through actions/setup-node, enables Corepack, installs with
    // frozen lockfile, calls package:runtime with the checked target/runtime directory, and uploads
    // the archive. ci-cd.yml changes its Node setup from 20 to 22.
    //
    // The artifact contract documents runtime-manifest.json, endpoint.json, health URLs, runtime host
    // command, per-user data preservation, and exact installer ownership. RELEASE-GUIDE removes the
    // obsolete dev-release archive workflow. The acceptance harness uses only public runtime host,
    // discovery, health, crash-recovery, and shutdown behavior.

- [ ] **Step 4: Run complete verification**

Run: pnpm --filter @arc/api run test:unit

Expected: PASS

Run: pnpm --filter @arc/api run test:integration

Expected: PASS

Run: pnpm --filter @arc/api run test:e2e

Expected: PASS

Run: pnpm --filter @arc/runtime-host run test

Expected: PASS

Run: pnpm run build

Expected: PASS

Run: pnpm run format:check

Expected: PASS

### Commit: Release Pipeline and Acceptance Coverage

Use the commit skill to draft the commit message and wait for explicit approval:

    git add .github/workflows docs/RELEASE-GUIDE.md docs/desktop-distribution/backend-runtime-artifact-contract.md packages/runtime-host/tests/integration/runtime-artifact.spec.ts scripts/verify-backend-runtime.mjs
    git commit -m "ci(workspace): publish backend runtime artifacts" -m "Validate platform-specific backend payloads before installer assembly and document the installer contract." -m "Signed-off-by: Name <email>"

STOP - do not run git commit until the user explicitly approves the message.

## Plan Review

- Tasks 1 through 4 implement runtime configuration, data-root creation, loopback enforcement, health, discovery, logging, and shutdown.
- Task 5 implements independent supervision, crash recovery, and the future multi-service extension point.
- Tasks 6 and 7 implement relocatable artifacts, matching Node/sqlite3 ABI validation, installer boundaries, CI release output, and staged runtime acceptance.
- The plan does not modify @arc/core, implement a remote server, add network authentication, or change Electron domain UI.
