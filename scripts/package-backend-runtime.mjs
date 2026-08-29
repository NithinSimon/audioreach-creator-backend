import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRuntimeManifest} from './lib/runtime-manifest.mjs';
import {verifyBackendRuntime} from './verify-backend-runtime.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function packageBackendRuntime(options) {
  validateTarget(options);
  const version = options.version ?? JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ).version;
  const artifactName = `arc-backend-runtime-${options.targetPlatform}-${options.targetArch}-${version}`;
  const runtimeRoot = path.join(options.outputDirectory, artifactName);

  await rm(runtimeRoot, {force: true, recursive: true});
  await mkdir(runtimeRoot, {recursive: true});
  if (!options.skipBuild) {
    await execFileAsync('pnpm', ['run', 'build'], {cwd: repositoryRoot});
  }

  const appRoot = path.join(runtimeRoot, 'app');
  await execFileAsync(
    'pnpm',
    ['--filter', '@arc/api', 'deploy', '--prod', appRoot],
    {cwd: repositoryRoot},
  );
  await cp(options.nodeRuntimeDir, path.join(runtimeRoot, 'node'), {
    recursive: true,
  });
  await cp(
    path.join(repositoryRoot, 'packages', 'runtime-host', 'dist'),
    path.join(runtimeRoot, 'runtime-host', 'dist'),
    {recursive: true},
  );
  const services = JSON.parse(
    await readFile(
      path.join(repositoryRoot, 'packages', 'runtime-host', 'services.json'),
      'utf8',
    ),
  );
  if (options.targetPlatform === 'win32') {
    services.services[0].command = '../node/node.exe';
  }
  await writeFile(
    path.join(runtimeRoot, 'runtime-host', 'services.json'),
    `${JSON.stringify(services, null, 2)}\n`,
  );
  await mkdir(path.join(runtimeRoot, 'LICENSES'), {recursive: true});
  await cp(path.join(repositoryRoot, 'LICENSE.txt'), path.join(runtimeRoot, 'LICENSES', 'LICENSE.txt'), {
    recursive: true,
  });

  const manifest = await createRuntimeManifest(runtimeRoot, {
    version,
    apiCompatibilityVersion: 1,
    targetPlatform: options.targetPlatform,
    targetArch: options.targetArch,
    nodeVersion: options.nodeVersion ?? '22',
  });
  await writeFile(
    path.join(runtimeRoot, 'runtime-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await verifyBackendRuntime({runtimeRoot, skipLaunch: options.skipLaunch === true});
  const archivePath = `${runtimeRoot}.tar.gz`;
  await execFileAsync('tar', ['-czf', archivePath, '-C', options.outputDirectory, artifactName]);
  return {archivePath, manifest, runtimeRoot};
}

function validateTarget(options) {
  if (!options?.targetPlatform || !options?.targetArch || !options?.nodeRuntimeDir || !options?.outputDirectory) {
    throw new Error('targetPlatform, targetArch, nodeRuntimeDir, and outputDirectory are required');
  }
  const expected = `${options.targetPlatform}-${options.targetArch}`;
  const runtimeName = path.basename(path.resolve(options.nodeRuntimeDir)).toLowerCase();
  const namedTarget = /(win32|win|linux|darwin)[-_](x64|arm64)/.exec(runtimeName);
  const actual = namedTarget
    ? `${namedTarget[1] === 'win' ? 'win32' : namedTarget[1]}-${namedTarget[2]}`
    : `${process.platform}-${process.arch}`;
  if (actual !== expected) {
    throw new Error(`Node runtime platform does not match ${expected}`);
  }
}

function parseArguments(arguments_) {
  const [targetPlatform, targetArch, nodeRuntimeDir, outputDirectory] = arguments_;
  return {targetPlatform, targetArch, nodeRuntimeDir, outputDirectory};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  packageBackendRuntime(parseArguments(process.argv.slice(2))).catch(error => {
    console.error('Runtime packaging failed:', error);
    process.exitCode = 1;
  });
}
