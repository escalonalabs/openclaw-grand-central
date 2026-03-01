const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateStationEventV1,
  isStationEventV1,
  assertStationEventV1,
} = require('../src/index.js');

function buildValidEvent(overrides = {}) {
  return {
    version: '1.0',
    eventId: 'evt_01HZX4V8W4P7ZDTK0B5N9A4R73',
    occurredAt: '2026-03-01T12:00:00.000Z',
    eventType: 'lane.enqueue',
    severity: 'info',
    source: {
      agentId: 'agent-a4',
      workspaceId: 'workspace-omnia',
      laneId: 'lane-main',
      sessionId: 'session-1234',
    },
    payload: {
      queueDepth: 3,
      position: 2,
    },
    ...overrides,
  };
}

test('accepts a valid station event v1 payload', () => {
  const event = buildValidEvent();
  const result = validateStationEventV1(event);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.equal(isStationEventV1(event), true);
  assert.deepEqual(assertStationEventV1(event), event);
});

test('rejects payload when version is missing', () => {
  const { version, ...eventWithoutVersion } = buildValidEvent();
  const result = validateStationEventV1(eventWithoutVersion);

  assert.equal(result.valid, false);
  assert.equal(isStationEventV1(eventWithoutVersion), false);
  assert.ok(result.errors.some((issue) => issue.keyword === 'required' && issue.instancePath === ''));
});

test('rejects unknown top-level properties', () => {
  const event = buildValidEvent({ danger: true });
  const result = validateStationEventV1(event);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => issue.keyword === 'additionalProperties' && issue.instancePath === ''));
});

test('rejects mismatched payload for event type', () => {
  const event = buildValidEvent({
    eventType: 'approval.requested',
    payload: {
      queueDepth: 1,
      position: 0,
    },
  });

  const result = validateStationEventV1(event);

  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test('assertStationEventV1 throws with structured errors when invalid', () => {
  const event = buildValidEvent({
    payload: {
      queueDepth: -1,
      position: 0,
    },
  });

  assert.throws(
    () => assertStationEventV1(event),
    (error) => {
      assert.equal(error.name, 'StationEventValidationError');
      assert.equal(Array.isArray(error.errors), true);
      assert.ok(error.errors.length > 0);
      return true;
    },
  );
});
