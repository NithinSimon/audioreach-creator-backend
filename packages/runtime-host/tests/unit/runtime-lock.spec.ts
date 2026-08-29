import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {RuntimeLock} from '../../src/runtime-lock.js';

describe('RuntimeLock', () => {
  it('does not acquire a second lock while the first owner is active', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'arc-runtime-host-lock-'));
    const lockDirectory = path.join(root, 'runtime-host.lock');
    const first = await RuntimeLock.acquire(lockDirectory);
    try {
      await expect(RuntimeLock.acquire(lockDirectory)).rejects.toThrow(
        'Runtime host is already running',
      );
    } finally {
      await first.release();
      await rm(root, {force: true, recursive: true});
    }
  });
});
