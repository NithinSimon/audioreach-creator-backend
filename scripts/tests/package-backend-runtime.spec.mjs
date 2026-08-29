import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {packageBackendRuntime} from '../package-backend-runtime.mjs';

test('packaging rejects a Node runtime for a different platform', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'arc-runtime-package-'));
  const linuxNodeDirectory = path.join(root, 'node-linux-x64');
  try {
    await expect(
      packageBackendRuntime({
        targetPlatform: 'win32',
        targetArch: 'x64',
        nodeRuntimeDir: linuxNodeDirectory,
        outputDirectory: root,
      }),
    ).rejects.toThrow('Node runtime platform does not match win32-x64');
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});
