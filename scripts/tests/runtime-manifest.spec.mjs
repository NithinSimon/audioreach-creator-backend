import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRuntimeManifest, verifyRuntimeManifest} from '../lib/runtime-manifest.mjs';

test('manifest verification detects a modified staged file', async () => {
  const stagingDirectory = await mkdtemp(path.join(tmpdir(), 'arc-runtime-manifest-'));
  try {
    await mkdir(path.join(stagingDirectory, 'runtime-host'), {recursive: true});
    await writeFile(path.join(stagingDirectory, 'runtime-host', 'services.json'), '{"version":1}');
    const metadata = {version: '1.0.0', targetPlatform: 'linux', targetArch: 'x64'};
    const manifest = await createRuntimeManifest(stagingDirectory, metadata);
    await writeFile(path.join(stagingDirectory, 'runtime-host', 'services.json'), '{}');

    await expect(verifyRuntimeManifest(stagingDirectory, manifest)).rejects.toThrow(
      'Runtime manifest hash mismatch',
    );
  } finally {
    await rm(stagingDirectory, {force: true, recursive: true});
  }
});
