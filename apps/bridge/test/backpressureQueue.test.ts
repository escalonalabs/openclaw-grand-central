import assert from "node:assert/strict";
import test from "node:test";

import { BackpressureQueue } from "../src/backpressureQueue.ts";

test("drop-newest keeps oldest events and increments dropped counter", () => {
  const queue = new BackpressureQueue<number>({
    capacity: 2,
    dropPolicy: "drop-newest",
  });

  queue.enqueue(1);
  queue.enqueue(2);
  const result = queue.enqueue(3);

  assert.equal(result.accepted, false);
  assert.equal(result.dropped, 1);
  assert.equal(queue.depth, 2);
  assert.equal(queue.getDroppedEvents(), 1);
  assert.equal(queue.dequeue(), 1);
  assert.equal(queue.dequeue(), 2);
});

test("drop-oldest evicts oldest event and accepts newest", () => {
  const queue = new BackpressureQueue<number>({
    capacity: 2,
    dropPolicy: "drop-oldest",
  });

  queue.enqueue(10);
  queue.enqueue(20);
  const result = queue.enqueue(30);

  assert.equal(result.accepted, true);
  assert.equal(result.dropped, 1);
  assert.equal(queue.depth, 2);
  assert.equal(queue.getDroppedEvents(), 1);
  assert.equal(queue.dequeue(), 20);
  assert.equal(queue.dequeue(), 30);
});
