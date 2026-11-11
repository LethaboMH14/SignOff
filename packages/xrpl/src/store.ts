import type { JournalRecord } from './journal.js';
import type { JournalSink } from './reliable.js';
import type { Registry } from './registry.js';

/** Persists the local registry. Every write replaces the whole registry atomically. */
export interface RegistryStore {
  read(): Promise<Registry | null>;
  write(registry: Registry): Promise<void>;
}

/** The journal: append-only, read back in full when a run resumes. */
export interface JournalStore extends JournalSink {
  readAll(): Promise<JournalRecord[]>;
}

/** Test and tooling helper: a registry store that keeps everything in memory. */
export function memoryRegistryStore(
  initial: Registry | null = null,
): RegistryStore & { readonly current: () => Registry | null } {
  let current: Registry | null = initial;
  return {
    read: () => Promise.resolve(current),
    write: (registry) => {
      current = registry;
      return Promise.resolve();
    },
    current: () => current,
  };
}

/** Test and tooling helper: a journal that keeps records in memory. */
export function memoryJournalStore(): JournalStore & {
  readonly records: () => readonly JournalRecord[];
} {
  const records: JournalRecord[] = [];
  return {
    append: (record) => {
      records.push(record);
      return Promise.resolve();
    },
    readAll: () => Promise.resolve([...records]),
    records: () => records,
  };
}
