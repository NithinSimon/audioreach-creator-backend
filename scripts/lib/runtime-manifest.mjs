import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

export async function createRuntimeManifest(runtimeRoot, metadata) {
  const files = await listRuntimeFiles(runtimeRoot, ['runtime-manifest.json']);
  const sorted = files.sort();
  const entries = [];
  const concurrency = 64;
  for (let i = 0; i < sorted.length; i += concurrency) {
    const batch = sorted.slice(i, i + concurrency);
    const batchEntries = await Promise.all(
      batch.map(async relativePath => ({
        path: relativePath,
        sha256: await sha256File(path.join(runtimeRoot, relativePath)),
      })),
    );
    entries.push(...batchEntries);
  }
  return {schemaVersion: 1, ...metadata, files: entries};
}

export async function verifyRuntimeManifest(runtimeRoot, manifest) {
  for (const entry of manifest.files) {
    const filePath = path.join(runtimeRoot, entry.path);
    const actual = await sha256File(filePath);
    if (actual !== entry.sha256) {
      throw new Error(`Runtime manifest hash mismatch: ${entry.path}`);
    }
  }
}

export async function listRuntimeFiles(root, excludedNames = []) {
  const excluded = new Set(excludedNames);
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join('/');
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile() && !excluded.has(relativePath)) {
        files.push(relativePath);
      }
    }
  }
  await visit(root);
  return files;
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}
