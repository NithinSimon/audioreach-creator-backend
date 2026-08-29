import {spawn} from 'node:child_process';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyRuntimeManifest} from './lib/runtime-manifest.mjs';

export async function verifyBackendRuntime({runtimeRoot, skipLaunch = false}) {
  const manifest = JSON.parse(
    await readFile(path.join(runtimeRoot, 'runtime-manifest.json'), 'utf8'),
  );
  await verifyRuntimeManifest(runtimeRoot, manifest);
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
  const runtimeHostEntry = path.join(runtimeRoot, 'runtime-host', 'dist', 'index.js');
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
    child.kill('SIGTERM');
    const exitCode = await waitForExit(child, 10_000);
    if (exitCode !== 0) {
      throw new Error(`Runtime host exited with status ${String(exitCode)}`);
    }
    await waitForEndpointRemoval(dataDir, 10_000);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
    await rm(dataDir, {force: true, recursive: true});
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
    const timeout = setTimeout(() => reject(new Error('Runtime did not exit')), timeoutMs);
    child.once('exit', code => {
      clearTimeout(timeout);
      resolve(code);
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
