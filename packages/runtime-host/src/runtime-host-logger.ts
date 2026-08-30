import {mkdir, open} from 'node:fs/promises';
import path from 'node:path';

export class RuntimeHostLogger {
  private file: Awaited<ReturnType<typeof open>> | undefined;

  constructor(private readonly logsDir: string) {}

  async log(msg: string, fields: Record<string, unknown> = {}): Promise<void> {
    await mkdir(this.logsDir, {recursive: true});
    this.file ??= await open(
      path.join(this.logsDir, 'runtime-host.jsonl'),
      'a',
    );
    await this.file.appendFile(
      `${JSON.stringify({
        msg,
        component: 'RuntimeHost',
        action: 'supervision',
        tag: 'runtime',
        timestamp: new Date().toISOString(),
        ...fields,
      })}\n`,
      'utf8',
    );
  }

  async close(): Promise<void> {
    await this.file?.close();
    this.file = undefined;
  }
}
