import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadServiceManifest} from './service-manifest.js';
import {RuntimeHost} from './runtime-host.js';

export {HealthClient} from './health-client.js';
export {RuntimeLock} from './runtime-lock.js';
export {parseServiceManifest, type ServiceDefinition} from './service-manifest.js';
export {RuntimeHost} from './runtime-host.js';
export {RuntimeHostLogger} from './runtime-host-logger.js';

async function main(): Promise<void> {
  const runtimeHostDirectory = path.dirname(fileURLToPath(import.meta.url));
  const runtimeRoot = process.env.ARC_RUNTIME_ROOT ?? path.resolve(runtimeHostDirectory, '..', '..');
  const dataDir = process.env.ARC_DATA_DIR;
  if (!dataDir) {
    throw new Error('ARC_DATA_DIR is required for the runtime host');
  }
  const manifest = await loadServiceManifest(
    path.join(runtimeRoot, 'runtime-host', 'services.json'),
  );
  const services = manifest.services.map(service => ({
    ...service,
    command: path.resolve(runtimeRoot, 'runtime-host', service.command),
    arguments: service.arguments.map(argument =>
      path.resolve(runtimeRoot, 'runtime-host', argument),
    ),
  }));
  const runtimeHost = new RuntimeHost({services, dataDir});
  const stop = () => {
    void runtimeHost.stop().catch(error => {
      console.error('Runtime host shutdown failed:', error);
      process.exitCode = 1;
    });
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  await runtimeHost.ensureRunning();
  await runtimeHost.monitor();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Runtime host failed:', error);
    process.exitCode = 1;
  });
}
