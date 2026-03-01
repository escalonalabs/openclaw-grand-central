const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertAdapterContract,
  createLogTailAdapter,
  createPluginAdapter,
} = require('../src');

test('log-tail adapter implements the bridge adapter contract', async () => {
  const emitted = [];
  const adapter = createLogTailAdapter();

  assert.doesNotThrow(() => assertAdapterContract(adapter));

  await adapter.start((event) => emitted.push(event));

  const event = adapter.ingestLine(
    '{"timestamp":"2026-03-01T16:00:00.000Z","event":"lane.enqueue","laneId":"lane-a","agentId":"agent-7","message":"queued","level":"info"}'
  );

  assert.equal(event.type, 'lane.enqueue');
  assert.equal(event.source, 'log-tail');
  assert.equal(emitted.length, 1);

  await adapter.stop();
});

test('plugin adapter is a callable stub and remains contract compliant', async () => {
  const emitted = [];
  const adapter = createPluginAdapter();

  assert.doesNotThrow(() => assertAdapterContract(adapter));

  await adapter.start((event) => emitted.push(event));

  const result = adapter.emitPluginEvent({
    timestamp: '2026-03-01T16:02:00.000Z',
    event: 'plugin.todo',
    laneId: 'lane-plugin',
    message: 'stub invocation',
  });

  assert.equal(result.stub, true);
  assert.equal(result.event.type, 'plugin.todo');
  assert.equal(result.event.source, 'plugin-stub');
  assert.equal(emitted.length, 1);

  await adapter.stop();
});
