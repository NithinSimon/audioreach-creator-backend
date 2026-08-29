import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {RuntimeHost} from '../../src/runtime-host.js';

describe('RuntimeHost process recovery', () => {
  it('restarts a fixture that exits once and then becomes ready', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'arc-runtime-host-process-'));
    const fixture = fileURLToPath(new URL('./fixtures/fixture-api.mjs', import.meta.url));
    const runtimeHost = new RuntimeHost({
      dataDir,
      services: [
        {
          id: 'offline-api',
          command: process.execPath,
          arguments: [fixture],
          readinessPath: '/health/ready',
          dependsOn: [],
        },
      ],
      spawnChild: (command, arguments_, options) =>
        spawn(command, arguments_, {
          ...options,
          env: {...options.env, FIXTURE_MODE: 'crash-once-then-ready'},
        }),
      pollIntervalMs: 25,
      startupTimeoutMs: 5_000,
    });
    try {
      await runtimeHost.ensureRunning();
      expect(runtimeHost.restartCount()).toBe(1);
      await expect(runtimeHost.currentHealth()).resolves.toBe(true);
    } finally {
      await runtimeHost.stop();
      await rm(dataDir, {force: true, recursive: true});
    }
  });
});
