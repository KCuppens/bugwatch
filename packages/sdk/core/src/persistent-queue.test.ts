import { describe, it, expect } from "vitest";
import { createPersistentQueue } from "./persistent-queue";
import type { ErrorEvent } from "./types";

function makeEvent(id: string): ErrorEvent {
  return {
    event_id: id,
    timestamp: new Date().toISOString(),
    platform: "javascript",
    level: "error",
    message: `test event ${id}`,
  };
}

describe("MemoryQueue (Node environment)", () => {
  it("enqueue + drain returns events in order", async () => {
    const queue = createPersistentQueue({ enabled: true, maxEvents: 10 });
    await queue.enqueue(makeEvent("1"));
    await queue.enqueue(makeEvent("2"));
    await queue.enqueue(makeEvent("3"));

    const events = await queue.drain();
    expect(events).toHaveLength(3);
    expect(events[0]!.event_id).toBe("1");
    expect(events[1]!.event_id).toBe("2");
    expect(events[2]!.event_id).toBe("3");
  });

  it("drain clears the queue", async () => {
    const queue = createPersistentQueue({ enabled: true, maxEvents: 10 });
    await queue.enqueue(makeEvent("1"));
    await queue.drain();

    const second = await queue.drain();
    expect(second).toHaveLength(0);
  });

  it("evicts oldest when maxEvents exceeded", async () => {
    const queue = createPersistentQueue({ enabled: true, maxEvents: 2 });
    await queue.enqueue(makeEvent("1"));
    await queue.enqueue(makeEvent("2"));
    await queue.enqueue(makeEvent("3"));

    const events = await queue.drain();
    expect(events).toHaveLength(2);
    expect(events[0]!.event_id).toBe("2");
    expect(events[1]!.event_id).toBe("3");
  });

  it("size returns correct count", async () => {
    const queue = createPersistentQueue({ enabled: true, maxEvents: 10 });
    expect(await queue.size()).toBe(0);
    await queue.enqueue(makeEvent("1"));
    expect(await queue.size()).toBe(1);
    await queue.enqueue(makeEvent("2"));
    expect(await queue.size()).toBe(2);
  });

  it("clear empties the queue", async () => {
    const queue = createPersistentQueue({ enabled: true, maxEvents: 10 });
    await queue.enqueue(makeEvent("1"));
    await queue.enqueue(makeEvent("2"));
    await queue.clear();
    expect(await queue.size()).toBe(0);
  });

  it("NoopQueue when disabled", async () => {
    const queue = createPersistentQueue({ enabled: false });
    const ok = await queue.enqueue(makeEvent("1"));
    expect(ok).toBe(false);
    expect(await queue.drain()).toHaveLength(0);
    expect(await queue.size()).toBe(0);
  });

  it("operations never throw", async () => {
    const queue = createPersistentQueue({ enabled: true, maxEvents: 1 });
    await expect(queue.enqueue(makeEvent("1"))).resolves.not.toThrow();
    await expect(queue.drain()).resolves.not.toThrow();
    await expect(queue.clear()).resolves.not.toThrow();
    await expect(queue.size()).resolves.not.toThrow();
  });
});

function makeStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: async (k: string) => {
      data.delete(k);
    },
  };
}

describe("StorageQueue (custom storage adapter)", () => {
  it("is enabled by default when a storage adapter is given and persists JSON", async () => {
    const storage = makeStorage();
    const queue = createPersistentQueue({ storage });
    expect(await queue.enqueue(makeEvent("1"))).toBe(true);
    expect(storage.data.size).toBe(1);
    const events = await queue.drain();
    expect(events.map((e) => e.event_id)).toEqual(["1"]);
    expect(storage.data.size).toBe(0);
  });

  it("survives a new queue instance on the same storage (process restart)", async () => {
    const storage = makeStorage();
    await createPersistentQueue({ storage }).enqueue(makeEvent("1"));
    const events = await createPersistentQueue({ storage }).drain();
    expect(events).toHaveLength(1);
  });

  it("evicts oldest beyond maxEvents and serialises concurrent enqueues", async () => {
    const queue = createPersistentQueue({ storage: makeStorage(), maxEvents: 2 });
    await Promise.all([queue.enqueue(makeEvent("1")), queue.enqueue(makeEvent("2")), queue.enqueue(makeEvent("3"))]);
    const events = await queue.drain();
    expect(events.map((e) => e.event_id)).toEqual(["2", "3"]);
  });

  it("returns safe fallbacks when the adapter throws or holds corrupt data", async () => {
    const broken = {
      getItem: async () => {
        throw new Error("boom");
      },
      setItem: async () => {
        throw new Error("boom");
      },
      removeItem: async () => {
        throw new Error("boom");
      },
    };
    const queue = createPersistentQueue({ storage: broken });
    expect(await queue.enqueue(makeEvent("1"))).toBe(false);
    expect(await queue.drain()).toEqual([]);
    expect(await queue.size()).toBe(0);

    const corrupt = makeStorage();
    corrupt.data.set("bugwatch:pending-events", "{not json");
    expect(await createPersistentQueue({ storage: corrupt }).drain()).toEqual([]);
  });

  it("respects enabled:false even with storage", async () => {
    const storage = makeStorage();
    const queue = createPersistentQueue({ storage, enabled: false });
    expect(await queue.enqueue(makeEvent("1"))).toBe(false);
    expect(storage.data.size).toBe(0);
  });
});
