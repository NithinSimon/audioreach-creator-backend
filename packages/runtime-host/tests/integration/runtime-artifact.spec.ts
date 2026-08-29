import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const runtimeRoot = process.env.RUNTIME_ARTIFACT_ROOT;
const runtimeTest = runtimeRoot ? test : test.skip;

runtimeTest('publishes a loopback endpoint and recovers after API child crash', async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'arc-runtime-artifact-'));
  const [{RuntimeHost}, manifest] = await Promise.all([
    import(path.join(runtimeRoot, 'runtime-host', 'dist', 'runtime-host.js')),
    readFile(path.join(runtimeRoot, 'runtime-host', 'services.json'), 'utf8').then(JSON.parse),
  ]);
  const services = manifest.services.map(service => ({
    ...service,
    command: path.resolve(runtimeRoot, 'runtime-host', service.command),
    arguments: service.arguments.map(argument =>
      path.resolve(runtimeRoot, 'runtime-host', argument),
    ),
  }));
  const runtimeHost = new RuntimeHost({
    services,
    dataDir,
    pollIntervalMs: 100,
    startupTimeoutMs: 30_000,
  });

  try {
    await runtimeHost.ensureRunning();
    const endpoint = await waitForReadyEndpoint(dataDir);
    expect(endpoint.apiBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const monitor = runtimeHost.monitor();
    await runtimeHost.killChild('offline-api');
    const recovered = await waitForReadyEndpoint(dataDir);
    expect(recovered.apiBaseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    await runtimeHost.stop();
    await monitor;
  } finally {
    await runtimeHost.stop();
    await rm(dataDir, {force: true, recursive: true});
  }
}, 120_000);

async function waitForReadyEndpoint(dataDir: string): Promise<{apiBaseUrl: string}> {
  const endpointPath = path.join(dataDir, 'runtime', 'endpoint.json');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const endpoint = JSON.parse(await readFile(endpointPath, 'utf8')) as {
        apiBaseUrl: string;
      };
      const response = await fetch(`${endpoint.apiBaseUrl}/health/ready`);
      if (response.status === 200) {
        return endpoint;
      }
    } catch {
      // Wait for initial startup or runtime host recovery.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Runtime did not become ready');
}
