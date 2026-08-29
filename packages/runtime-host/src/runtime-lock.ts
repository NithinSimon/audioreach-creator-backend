import {randomUUID} from 'node:crypto';
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

export class RuntimeLock {
  private readonly ownerId = randomUUID();
  private released = false;

  private constructor(private readonly directory: string) {}

  static async acquire(directory: string): Promise<RuntimeLock> {
    try {
      await mkdir(directory, {recursive: false});
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error('Runtime host is already running');
      }
      throw error;
    }

    const lock = new RuntimeLock(directory);
    try {
      await writeFile(lock.ownerPath(), `${lock.ownerId}\n`, {mode: 0o600});
      return lock;
    } catch (error) {
      await rm(directory, {force: true, recursive: true});
      throw error;
    }
  }

  async release(): Promise<void> {
    if (this.released) {
      return;
    }
    this.released = true;

    try {
      const ownerId = (await readFile(this.ownerPath(), 'utf8')).trim();
      if (ownerId === this.ownerId) {
        await rm(this.directory, {force: true, recursive: true});
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private ownerPath(): string {
    return path.join(this.directory, 'owner');
  }
}
