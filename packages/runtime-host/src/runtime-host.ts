import type {ChildProcess, SpawnOptions} from 'node:child_process';
import {spawn as nodeSpawn} from 'node:child_process';
import path from 'node:path';
import {HealthClient} from './health-client.js';
import {RuntimeLock} from './runtime-lock.js';
import type {ServiceDefinition} from './service-manifest.js';
import {RuntimeHostLogger} from './runtime-host-logger.js';

type SpawnChild = (
  command: string,
  arguments_: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export type RuntimeHostOptions = Readonly<{
  services: readonly ServiceDefinition[];
  dataDir: string;
  lockDirectory?: string;
  healthClient?: HealthClient;
  logger?: RuntimeHostLogger;
  spawnChild?: SpawnChild;
  startupTimeoutMs?: number;
  pollIntervalMs?: number;
  maximumRetries?: number;
}>;

export class RuntimeHost {
  private readonly children = new Map<string, ChildProcess>();
  private readonly orderedServices: readonly ServiceDefinition[];
  private readonly endpointPath: string;
  private readonly lockDirectory: string;
  private readonly healthClient: HealthClient;
  private readonly logger: RuntimeHostLogger;
  private readonly spawnChild: SpawnChild;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maximumRetries: number;
  private lock: RuntimeLock | undefined;
  private readonly exitedServices = new Set<string>();
  private restarts = 0;
  private monitoring = false;

  constructor(private readonly options: RuntimeHostOptions) {
    this.orderedServices = orderServices(options.services);
    this.endpointPath = path.join(options.dataDir, 'runtime', 'endpoint.json');
    this.lockDirectory =
      options.lockDirectory ?? path.join(options.dataDir, 'runtime', 'runtime-host.lock');
    this.healthClient = options.healthClient ?? new HealthClient();
    this.logger = options.logger ?? new RuntimeHostLogger(path.join(options.dataDir, 'logs'));
    this.spawnChild = options.spawnChild ?? nodeSpawn;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.maximumRetries = options.maximumRetries ?? 5;
  }

  restartCount(): number {
    return this.restarts;
  }

  async currentHealth(): Promise<boolean> {
    const api = this.orderedServices.find(service => service.id === 'offline-api');
    return this.healthClient.isReady(this.endpointPath, api?.readinessPath);
  }

  async ensureRunning(): Promise<void> {
    if (this.lock) {
      return;
    }
    try {
      this.lock = await RuntimeLock.acquire(this.lockDirectory);
    } catch (error) {
      if (await this.currentHealth()) {
        return;
      }
      throw error;
    }

    try {
      await this.startServicesWithRetry();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  async monitor(): Promise<void> {
    this.monitoring = true;
    let consecutiveFailures = 0;
    while (this.monitoring) {
      const ready = await this.currentHealth();
      consecutiveFailures = ready ? 0 : consecutiveFailures + 1;
      if (consecutiveFailures >= 3 || this.hasExitedChild()) {
        await this.logger.log('Restarting unhealthy services', {
          action: 'restart',
          consecutiveFailures,
        });
        await this.restartAll();
        consecutiveFailures = 0;
      }
      await delay(this.pollIntervalMs);
    }
  }

  async stop(): Promise<void> {
    this.monitoring = false;
    for (const service of [...this.orderedServices].reverse()) {
      const child = this.children.get(service.id);
      if (!child) {
        continue;
      }
      await terminate(child, 10_000);
      this.children.delete(service.id);
    }
    await this.lock?.release();
    this.lock = undefined;
    await this.logger.close();
  }

  async killChild(serviceId: string): Promise<void> {
    const child = this.children.get(serviceId);
    if (!child || child.exitCode !== null) {
      return;
    }
    child.kill('SIGKILL');
  }

  private async startServicesWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maximumRetries; attempt += 1) {
      try {
        this.startServices();
        await this.waitForReady();
        return;
      } catch (error) {
        lastError = error;
        this.restarts += 1;
        await this.logger.log('Service startup attempt failed', {
          action: 'start_failure',
          attempt,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.stopChildren();
        if (attempt < this.maximumRetries) {
          await delay(Math.min(1_000 * 2 ** attempt, 10_000));
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('Runtime services did not become ready');
  }

  private startServices(): void {
    this.exitedServices.clear();
    for (const service of this.orderedServices) {
      if (this.children.has(service.id)) {
        continue;
      }
      const child = this.spawnChild(service.command, [...service.arguments], {
        env: {
          ...process.env,
          ARC_RUNTIME_MODE: 'desktop',
          ARC_DATA_DIR: this.options.dataDir,
          ARC_SERVICE_ID: service.id,
        },
        stdio: 'ignore',
      });
      child.once('exit', () => {
        this.children.delete(service.id);
        this.exitedServices.add(service.id);
      });
      child.once('error', () => {
        this.children.delete(service.id);
        this.exitedServices.add(service.id);
      });
      this.children.set(service.id, child);
    }
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + this.startupTimeoutMs;
    while (Date.now() < deadline) {
      if (await this.currentHealth()) {
        return;
      }
      if (this.hasExitedChild()) {
        throw new Error('A supervised service exited before becoming ready');
      }
      await delay(this.pollIntervalMs);
    }
    throw new Error('Timed out waiting for runtime readiness');
  }

  private hasExitedChild(): boolean {
    return (
      this.exitedServices.size > 0 ||
      [...this.children.values()].some(child => child.exitCode !== null)
    );
  }

  private async restartAll(): Promise<void> {
    await this.stopChildren();
    this.restarts += 1;
    await this.startServicesWithRetry();
  }

  private async stopChildren(): Promise<void> {
    for (const child of this.children.values()) {
      await terminate(child, 10_000);
    }
    this.children.clear();
  }
}

function orderServices(services: readonly ServiceDefinition[]): readonly ServiceDefinition[] {
  const byId = new Map(services.map(service => [service.id, service]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: ServiceDefinition[] = [];

  const visit = (service: ServiceDefinition): void => {
    if (visited.has(service.id)) {
      return;
    }
    if (visiting.has(service.id)) {
      throw new Error(`Service dependency cycle includes ${service.id}`);
    }
    visiting.add(service.id);
    for (const dependencyId of service.dependsOn) {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        throw new Error(`Service ${service.id} depends on unknown service ${dependencyId}`);
      }
      visit(dependency);
    }
    visiting.delete(service.id);
    visited.add(service.id);
    ordered.push(service);
  };

  for (const service of services) {
    visit(service);
  }
  return ordered;
}

async function terminate(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(timeoutMs)]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
