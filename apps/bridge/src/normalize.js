const { createHash } = require('node:crypto');

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);

/**
 * @typedef {import('./types').StationEvent} StationEvent
 * @typedef {import('./types').StationEventInput} StationEventInput
 */

/**
 * Normalize arbitrary adapter payload into a stable StationEvent-like shape.
 *
 * @param {StationEventInput} input
 * @returns {StationEvent}
 */
function normalizeStationEvent(input = {}) {
  const payload = asObject(input);
  const ts = toIsoTimestamp(
    pickFirst(payload, ['ts', 'timestamp', 'time', 'createdAt'])
  );
  const type = normalizeType(pickFirst(payload, ['type', 'event', 'action']));
  const message = normalizeMessage(pickFirst(payload, ['message', 'msg']), type);
  const source = toStringOrFallback(payload.source, 'unknown');
  const level = normalizeLevel(pickFirst(payload, ['level', 'severity']));
  const laneId = toNullableString(pickFirst(payload, ['laneId', 'lane', 'lane_id']));
  const agentId = toNullableString(
    pickFirst(payload, ['agentId', 'agent', 'agent_id', 'runtimeId'])
  );
  const stationId = toNullableString(
    pickFirst(payload, ['stationId', 'station', 'workspace', 'workspaceId'])
  );
  const metadata = normalizeMetadata(payload.metadata || payload.meta);
  const raw = Object.prototype.hasOwnProperty.call(payload, 'raw') ? payload.raw : payload;

  const id = makeEventId({
    ts,
    source,
    type,
    laneId,
    agentId,
    stationId,
    message,
  });

  return {
    id,
    ts,
    source,
    type,
    level,
    message,
    laneId,
    agentId,
    stationId,
    metadata,
    raw,
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function toIsoTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.valueOf())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

/**
 * @param {unknown} value
 * @returns {'debug'|'info'|'warn'|'error'}
 */
function normalizeLevel(value) {
  const raw = String(value || 'info').toLowerCase();
  if (raw === 'warning') {
    return 'warn';
  }
  if (LEVELS.has(raw)) {
    return raw;
  }
  return 'info';
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeType(value) {
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return 'telemetry.unknown';
}

/**
 * @param {unknown} candidate
 * @param {string} fallbackType
 * @returns {string}
 */
function normalizeMessage(candidate, fallbackType) {
  if (typeof candidate === 'string' && candidate.trim() !== '') {
    return candidate.trim();
  }
  return fallbackType;
}

/**
 * @param {unknown} value
 * @returns {Record<string, string|number|boolean|null>}
 */
function normalizeMetadata(value) {
  const metadata = asObject(value);
  /** @type {Record<string, string|number|boolean|null>} */
  const normalized = {};

  for (const [key, rawValue] of Object.entries(metadata)) {
    normalized[key] = coerceMetadataValue(rawValue);
  }

  return normalized;
}

/**
 * @param {unknown} value
 * @returns {string|number|boolean|null}
 */
function coerceMetadataValue(value) {
  if (value === null) {
    return null;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return '';
    }
    if (trimmed === 'true') {
      return true;
    }
    if (trimmed === 'false') {
      return false;
    }
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const maybeNumber = Number(trimmed);
      if (Number.isFinite(maybeNumber)) {
        return maybeNumber;
      }
    }
    return trimmed;
  }
  return JSON.stringify(value);
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return {};
}

/**
 * @param {Record<string, unknown>} source
 * @param {string[]} keys
 * @returns {unknown}
 */
function pickFirst(source, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = source[key];
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
  }
  return undefined;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function toNullableString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const asString = String(value).trim();
  return asString === '' ? null : asString;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function toStringOrFallback(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const asString = String(value).trim();
  return asString === '' ? fallback : asString;
}

/**
 * @param {{ts: string, source: string, type: string, laneId: string|null, agentId: string|null, stationId: string|null, message: string}} seed
 * @returns {string}
 */
function makeEventId(seed) {
  return createHash('sha1').update(JSON.stringify(seed)).digest('hex').slice(0, 16);
}

module.exports = {
  normalizeStationEvent,
  normalizeLevel,
  toIsoTimestamp,
};
