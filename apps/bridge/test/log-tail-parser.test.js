const assert = require('node:assert/strict');
const test = require('node:test');

const { createLogTailAdapter, parseLogLine } = require('../src');

test('parseLogLine parses JSON log lines into canonical intermediate shape', () => {
  const parsed = parseLogLine(
    '{"timestamp":"2026-03-01T17:10:00.000Z","event":"tool.start","laneId":"lane-1","agentId":"agent-1","message":"tool started","meta":{"tool":"bash"}}'
  );

  assert.equal(parsed.event, 'tool.start');
  assert.equal(parsed.laneId, 'lane-1');
  assert.equal(parsed.agentId, 'agent-1');
  assert.equal(parsed.metadata.tool, 'bash');
});

test('log-tail adapter parses key-value lines and emits normalized station events', async () => {
  const emitted = [];
  const adapter = createLogTailAdapter();
  await adapter.start((event) => emitted.push(event));

  const event = adapter.ingestLine(
    '2026-03-01T17:00:00.000Z level=warn event=exec.approval lane=lane-22 agent=agent-5 station=workspace-omnia message="approval required" queueDepth=3'
  );

  assert.equal(event.type, 'exec.approval');
  assert.equal(event.level, 'warn');
  assert.equal(event.laneId, 'lane-22');
  assert.equal(event.agentId, 'agent-5');
  assert.equal(event.stationId, 'workspace-omnia');
  assert.equal(event.metadata.queueDepth, 3);
  assert.equal(event.source, 'log-tail');
  assert.equal(emitted.length, 1);

  await adapter.stop();
});

test('log-tail adapter ignores empty lines', async () => {
  const emitted = [];
  const adapter = createLogTailAdapter();
  await adapter.start((event) => emitted.push(event));

  const event = adapter.ingestLine('   ');
  assert.equal(event, null);
  assert.equal(emitted.length, 0);

  await adapter.stop();
});
