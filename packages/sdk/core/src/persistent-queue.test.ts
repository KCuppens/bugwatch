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
