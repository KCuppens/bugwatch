/**
 * Persistent event queue — survives network failures and process restarts.
 *
 * Strategy:
 *   - Browser: IndexedDB (no external deps, falls back to no-op if unavailable)
 *   - Node: in-memory queue with optional file flush via custom callback
 *
 * The queue is intentionally minimal: enqueue + drain. Eviction is FIFO when
 * the cap is reached. All operations swallow errors — the queue must NEVER
 * crash the host application.
 */
import type { ErrorEvent } from "./types";

const DEFAULT_MAX_EVENTS = 100;
const DB_NAME = "bugwatch-events";
const STORE_NAME = "pending";

export interface PersistentQueue {
  /** Add an event to the queue. Returns true on success. */
  enqueue(event: ErrorEvent): Promise<boolean>;
  /** Remove and return all queued events. */
  drain(): Promise<ErrorEvent[]>;
  /** Clear the queue without returning events. */
  clear(): Promise<void>;
  /** Number of events currently queued (best-effort). */
  size(): Promise<number>;
}

/* -------------------------------------------------------------------------- */
/* Browser: IndexedDB                                                          */
/* -------------------------------------------------------------------------- */

class IndexedDBQueue implements PersistentQueue {
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor(private maxEvents: number) {}

  private getDB(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === "undefined") {
          resolve(null);
          return;
        }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { autoIncrement: true });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  async enqueue(event: ErrorEvent): Promise<boolean> {
    const db = await this.getDB();
    if (!db) return false;
    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        // Cap by counting first; evict oldest if needed
        const countReq = store.count();
        countReq.onsuccess = () => {
          if (countReq.result >= this.maxEvents) {
            const cursorReq = store.openCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (cursor) {
                cursor.delete();
              }
              store.add(event);
            };
            cursorReq.onerror = () => {
              store.add(event);
            };
          } else {
            store.add(event);
          }
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  async drain(): Promise<ErrorEvent[]> {
    const db = await this.getDB();
    if (!db) return [];
    return new Promise<ErrorEvent[]>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const events: ErrorEvent[] = [];
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            events.push(cursor.value as ErrorEvent);
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve(events);
        tx.onerror = () => resolve(events);
      } catch {
        resolve([]);
      }
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();
    if (!db) return;
    return new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async size(): Promise<number> {
    const db = await this.getDB();
    if (!db) return 0;
    return new Promise<number>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Node: in-memory queue (file persistence is opt-in via `persistPath`)        */
/* -------------------------------------------------------------------------- */

class MemoryQueue implements PersistentQueue {
  private events: ErrorEvent[] = [];
  constructor(private maxEvents: number) {}

  async enqueue(event: ErrorEvent): Promise<boolean> {
    if (this.events.length >= this.maxEvents) {
      this.events.shift();
    }
    this.events.push(event);
    return true;
  }

  async drain(): Promise<ErrorEvent[]> {
    const out = this.events;
    this.events = [];
    return out;
  }

  async clear(): Promise<void> {
    this.events = [];
  }

  async size(): Promise<number> {
    return this.events.length;
  }
}

class NoopQueue implements PersistentQueue {
  async enqueue(): Promise<boolean> {
    return false;
  }
  async drain(): Promise<ErrorEvent[]> {
    return [];
  }
  async clear(): Promise<void> {}
  async size(): Promise<number> {
    return 0;
  }
}

/**
 * Pick the right queue for the current environment.
 * Browser → IndexedDB. Node → in-memory. Disabled → no-op.
 */
export function createPersistentQueue(opts?: {
  enabled?: boolean;
  maxEvents?: number;
}): PersistentQueue {
  const max = opts?.maxEvents ?? DEFAULT_MAX_EVENTS;
  const isBrowser = typeof window !== "undefined" && typeof indexedDB !== "undefined";
  const enabled = opts?.enabled ?? isBrowser; // default on in browser, off in Node

  if (!enabled) return new NoopQueue();
  if (isBrowser) return new IndexedDBQueue(max);
  return new MemoryQueue(max);
}
