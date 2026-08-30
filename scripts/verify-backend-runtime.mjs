import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {verifyRuntimeManifest} from './lib/runtime-manifest.mjs';

export async function verifyBackendRuntime({runtimeRoot, skipLaunch = false}) {
  const manifest = JSON.parse(
    await readFile(path.join(runtimeRoot, 'runtime-manifest.json'), 'utf8'),
  );
  await verifyRuntimeManifest(runtimeRoot, manifest);
  await verifyManifestDetectsTampering(runtimeRoot, manifest);
  if (skipLaunch) {
    return;
  }

  const dataDir = await mkdtemp(path.join(tmpdir(), 'arc-runtime-verify-'));
  const nodeExecutable = path.join(
    runtimeRoot,
    'node',
    process.platform === 'win32' ? 'node.exe' : 'bin',
    process.platform === 'win32' ? '' : 'node',
  );
  const runtimeHostEntry = path.join(
    runtimeRoot,
    'runtime-host',
    'dist',
    'index.js',
  );
  const child = spawn(nodeExecutable, [runtimeHostEntry], {
    env: {
      ...process.env,
      ARC_RUNTIME_ROOT: runtimeRoot,
      ARC_DATA_DIR: dataDir,
      ARC_PORT: '0',
    },
    stdio: 'ignore',
  });
  try {
    const endpoint = await waitForReadyEndpoint(dataDir, 30_000);
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint.apiBaseUrl)) {
      throw new Error('Runtime published a non-loopback endpoint');
    }
    await readFile(
      path.join(dataDir, 'runtime', 'runtime-host.lock', 'owner'),
      'utf8',
    );
    await verifyHealthEndpoints(endpoint.apiBaseUrl);
    child.kill('SIGTERM');
    const {code: exitCode, signal: exitSignal} = await waitForExit(
      child,
      10_000,
    );
    const sigTermKill = exitCode === null && exitSignal === 'SIGTERM';
    if (!sigTermKill && exitCode !== 0) {
      throw new Error(`Runtime host exited with status ${String(exitCode)}`);
    }
    if (!sigTermKill) {
      await waitForEndpointRemoval(dataDir, 10_000);
    }
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
    await rmWithRetry(dataDir);
  }

  await verifyApiCrashRecovery(runtimeRoot);
}

async function verifyManifestDetectsTampering(runtimeRoot, manifest) {
  const entry = manifest.files.find(
    file => file.path === 'runtime-host/services.json',
  );
  if (!entry) {
    throw new Error(
      'Runtime manifest does not include runtime-host/services.json',
    );
  }
  const filePath = path.join(runtimeRoot, entry.path);
  const original = await readFile(filePath);
  await writeFile(filePath, Buffer.concat([original, Buffer.from(' ')]));
  try {
    await verifyRuntimeManifest(runtimeRoot, manifest);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Runtime manifest hash mismatch')
    ) {
      return;
    }
    throw error;
  } finally {
    await writeFile(filePath, original);
  }
  throw new Error(
    'Runtime manifest did not detect a tampered runtime-host/services.json',
  );
}

async function verifyHealthEndpoints(apiBaseUrl) {
  const [live, ready] = await Promise.all([
    fetch(`${apiBaseUrl}/health/live`),
    fetch(`${apiBaseUrl}/health/ready`),
  ]);
  if (live.status !== 200 || ready.status !== 200) {
    throw new Error(
      `Runtime health endpoints are not ready: live=${live.status}, ready=${ready.status}`,
    );
  }
}

async function verifyApiCrashRecovery(runtimeRoot) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'arc-runtime-recovery-'));
  const [{RuntimeHost}, manifest] = await Promise.all([
    import(
      pathToFileURL(
        path.join(runtimeRoot, 'runtime-host', 'dist', 'runtime-host.js'),
      ).href
    ),
    readFile(
      path.join(runtimeRoot, 'runtime-host', 'services.json'),
      'utf8',
    ).then(JSON.parse),
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
    await waitForReadyEndpoint(dataDir, 30_000);
    await runtimeHost.killChild('offline-api');
    const monitor = runtimeHost.monitor();
    try {
      const after = await waitForRecovery(dataDir, runtimeHost, 30_000);
      await verifyHealthEndpoints(after.apiBaseUrl);
      await readFile(path.join(dataDir, 'logs', 'runtime-host.jsonl'), 'utf8');
    } finally {
      await runtimeHost.stop();
      await monitor;
    }
  } finally {
    await runtimeHost.stop();
    await rmWithRetry(dataDir);
  }
}

async function waitForRecovery(dataDir, runtimeHost, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (runtimeHost.restartCount() > 0) {
      try {
        return await waitForReadyEndpoint(dataDir, 1_000);
      } catch {
        // The restarted API has not published readiness yet.
      }
    }
    await delay(100);
  }
  throw new Error(
    'Runtime host did not restart the API after its child crashed',
  );
}

async function rmWithRetry(directory) {
  for (let i = 0; i < 5; i++) {
    try {
      await rm(directory, {force: true, recursive: true});
      return;
    } catch (error) {
      if (error.code === 'EBUSY' && i < 4) {
        await delay(200);
      } else if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

export async function waitForReadyEndpoint(dataDir, timeoutMs) {
  const endpointPath = path.join(dataDir, 'runtime', 'endpoint.json');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const endpoint = JSON.parse(await readFile(endpointPath, 'utf8'));
      const response = await fetch(`${endpoint.apiBaseUrl}/health/ready`);
      if (response.status === 200) {
        return endpoint;
      }
    } catch {
      // The API is still starting or has not published its endpoint yet.
    }
    await delay(100);
  }
  throw new Error('Runtime did not publish a ready endpoint before timeout');
}

async function waitForEndpointRemoval(dataDir, timeoutMs) {
  const endpointPath = path.join(dataDir, 'runtime', 'endpoint.json');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(endpointPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    await delay(100);
  }
  throw new Error('Runtime did not remove endpoint.json during shutdown');
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Runtime did not exit')),
      timeoutMs,
    );
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({code, signal});
    });
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runtimeRoot = process.argv[2];
  if (!runtimeRoot) {
    throw new Error('Usage: verify-backend-runtime.mjs <runtime-root>');
  }
  verifyBackendRuntime({runtimeRoot}).catch(error => {
    console.error('Runtime verification failed:', error);
    process.exitCode = 1;
  });
}
