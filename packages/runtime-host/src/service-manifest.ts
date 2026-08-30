import {readFile} from 'node:fs/promises';

export type ServiceDefinition = Readonly<{
  id: string;
  command: string;
  arguments: readonly string[];
  readinessPath: '/health/ready';
  dependsOn: readonly string[];
}>;

export type ServiceManifest = Readonly<{
  schemaVersion: 1;
  services: readonly ServiceDefinition[];
}>;

export function parseServiceManifest(value: unknown): ServiceManifest {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.services)
  ) {
    throw new Error(
      'Service manifest must contain schemaVersion 1 and services',
    );
  }

  const services = value.services.map(service => parseService(service));
  const ids = new Set<string>();
  for (const service of services) {
    if (ids.has(service.id)) {
      throw new Error(`Service ${service.id} is defined more than once`);
    }
    ids.add(service.id);
  }

  return {schemaVersion: 1, services};
}

export async function loadServiceManifest(
  path: string,
): Promise<ServiceManifest> {
  return parseServiceManifest(JSON.parse(await readFile(path, 'utf8')));
}

function parseService(value: unknown): ServiceDefinition {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    value.id.length === 0
  ) {
    throw new Error('Each service must define a non-empty id');
  }
  if (
    typeof value.command !== 'string' ||
    typeof value.readinessPath !== 'string'
  ) {
    throw new Error(
      `Service ${value.id} must define command and readinessPath`,
    );
  }
  if (value.readinessPath !== '/health/ready') {
    throw new Error(`Service ${value.id} readinessPath must be /health/ready`);
  }
  if (!Array.isArray(value.arguments) || !value.arguments.every(isString)) {
    throw new Error(
      `Service ${value.id} arguments must be an array of strings`,
    );
  }
  if (!Array.isArray(value.dependsOn) || !value.dependsOn.every(isString)) {
    throw new Error(
      `Service ${value.id} dependsOn must be an array of strings`,
    );
  }
  return {
    id: value.id,
    command: value.command,
    arguments: value.arguments,
    readinessPath: value.readinessPath,
    dependsOn: value.dependsOn,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
