import {readFile} from 'node:fs/promises';

export class HealthClient {
  constructor(private readonly timeoutMs = 5_000) {}

  async isReady(endpointPath: string, readinessPath = '/health/ready'): Promise<boolean> {
    try {
      const endpoint = JSON.parse(await readFile(endpointPath, 'utf8')) as {
        apiBaseUrl?: unknown;
      };
      if (typeof endpoint.apiBaseUrl !== 'string') {
        return false;
      }
      const baseUrl = new URL(endpoint.apiBaseUrl);
      if (baseUrl.protocol !== 'http:' || baseUrl.hostname !== '127.0.0.1') {
        return false;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(new URL(readinessPath, baseUrl), {
          signal: controller.signal,
        });
        return response.status === 200;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      return false;
    }
  }
}
