import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_VERSION, type Snapshot } from './types.js';

export class CacheLockedError extends Error {
  constructor() {
    super(
      'Another process is refreshing the cache (lock held). Try again shortly or use the existing snapshot.',
    );
    this.name = 'CacheLockedError';
  }
}

export interface SnapshotStore {
  /** Human-readable location (directory name only; never an absolute home path in tool output). */
  readonly label: string;
  /** Null when no snapshot exists or its schema version differs (rebuild). */
  load(): Promise<Snapshot | null>;
  /** Atomic: write a temp file, then rename. */
  save(snapshot: Snapshot): Promise<void>;
  /** Exclusive refresh lock with a stale timeout. Returns the release function. Throws CacheLockedError. */
  lock(): Promise<() => Promise<void>>;
  sizeBytes(): Promise<number | null>;
}

export interface FileStoreOptions {
  staleLockMs?: number;
  now?: () => number;
}

export function createFileStore(dir: string, options: FileStoreOptions = {}): SnapshotStore {
  const staleLockMs = options.staleLockMs ?? 10 * 60_000;
  const now = options.now ?? Date.now;
  const file = join(dir, 'snapshot.json');
  const lockFile = join(dir, 'snapshot.lock');

  async function tryCreateLock(token: string): Promise<boolean> {
    try {
      const handle = await open(lockFile, 'wx');
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, at: now() }));
      await handle.close();
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw e;
    }
  }

  return {
    label: dir.split('/').slice(-2).join('/'),
    async load() {
      try {
        const snap = JSON.parse(await readFile(file, 'utf8')) as Snapshot;
        return snap.version === CACHE_VERSION ? snap : null;
      } catch {
        return null;
      }
    },
    async save(snapshot) {
      await mkdir(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
      await writeFile(tmp, JSON.stringify(snapshot));
      await rename(tmp, file);
    },
    async lock() {
      await mkdir(dir, { recursive: true });
      const token = randomBytes(8).toString('hex');
      if (!(await tryCreateLock(token))) {
        const age = await stat(lockFile).then(
          (s) => now() - s.mtimeMs,
          () => Number.POSITIVE_INFINITY,
        );
        if (age <= staleLockMs) throw new CacheLockedError();
        await unlink(lockFile).catch(() => undefined); // stale: take over
        if (!(await tryCreateLock(token))) throw new CacheLockedError();
      }
      return async () => {
        try {
          const held = JSON.parse(await readFile(lockFile, 'utf8')) as { token?: string };
          if (held.token === token) await unlink(lockFile);
        } catch {
          /* already gone */
        }
      };
    },
    sizeBytes: () =>
      stat(file).then(
        (s) => s.size,
        () => null,
      ),
  };
}

/** In-memory store for tests: JSON-clones on load and save, simulates the lock. */
export function createMemoryStore(
  initial: Snapshot | null = null,
): SnapshotStore & { locked: boolean; saves: number } {
  let data: string | null = initial ? JSON.stringify(initial) : null;
  const store = {
    label: 'memory',
    locked: false,
    saves: 0,
    async load() {
      return data ? (JSON.parse(data) as Snapshot) : null;
    },
    async save(snapshot: Snapshot) {
      data = JSON.stringify(snapshot);
      store.saves++;
    },
    async lock() {
      if (store.locked) throw new CacheLockedError();
      store.locked = true;
      return async () => {
        store.locked = false;
      };
    },
    async sizeBytes() {
      return data ? data.length : null;
    },
  };
  return store;
}
