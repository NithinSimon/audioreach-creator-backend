import {mkdir, readFile, writeFile} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const dataDir = process.env.ARC_DATA_DIR;
const marker = path.join(dataDir, 'fixture-crashed-once');
if (process.env.FIXTURE_MODE === 'crash-once-then-ready') {
  try {
    await readFile(marker);
  } catch {
    await writeFile(marker, '1');
    process.exit(1);
  }
}

const runtimeDir = path.join(dataDir, 'runtime');
await mkdir(runtimeDir, {recursive: true});
const server = http.createServer((request, response) => {
  response.writeHead(request.url === '/health/ready' ? 200 : 404);
  response.end();
});
server.listen(0, '127.0.0.1', async () => {
  const address = server.address();
  await writeFile(
    path.join(runtimeDir, 'endpoint.json'),
    `${JSON.stringify({schemaVersion: 1, apiBaseUrl: `http://127.0.0.1:${address.port}`})}\n`,
  );
});
process.once('SIGTERM', () => server.close(() => process.exit(0)));
