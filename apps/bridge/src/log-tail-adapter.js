const { assertAdapterContract } = require('./contract');
const { normalizeStationEvent } = require('./normalize');

const KV_PAIR_PATTERN =
  /([A-Za-z_][\w.-]*)=("([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s]+)/g;
const ISO_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2}T[^\s]+)\s*(.*)$/;

const KNOWN_KEYS = new Set([
  'event',
  'type',
  'action',
  'timestamp',
  'ts',
  'time',
  'level',
  'severity',
  'message',
  'msg',
  'lane',
  'laneId',
  'lane_id',
  'agent',
  'agentId',
  'agent_id',
  'station',
  'stationId',
  'station_id',
  'workspace',
  'meta',
  'metadata',
  'raw',
]);

/**
 * @typedef {import('./types').BridgeEventEmitter} BridgeEventEmitter
 * @typedef {import('./types').LogTailAdapter} LogTailAdapter
 * @typedef {import('./types').ParsedLogRecord} ParsedLogRecord
 */

/**
 * @param {{source?: string}=} options
 * @returns {LogTailAdapter}
 */
function createLogTailAdapter(options = {}) {
  const source =
    typeof options.source === 'string' && options.source.trim() !== ''
      ? options.source.trim()
      : 'log-tail';

  /** @type {BridgeEventEmitter|null} */
  let emit = null;
  let running = false;

  const adapter = {
    name: 'log-tail',
    kind: 'log-tail',

    /**
     * @param {BridgeEventEmitter} handler
     */
    async start(handler) {
      if (typeof handler !== 'function') {
        throw new TypeError('log-tail adapter start(handler) requires a function.');
      }
      emit = handler;
      running = true;
    },

    async stop() {
      running = false;
      emit = null;
    },

    /**
     * Parse one raw log line and emit a normalized event if valid.
     *
     * @param {string} line
     * @returns {import('./types').StationEvent|null}
     */
    ingestLine(line) {
      const parsed = parseLogLine(line);
      if (!parsed) {
        return null;
      }

      const event = normalizeStationEvent({
        source,
        timestamp: parsed.timestamp,
        event: parsed.event,
        level: parsed.level,
        message: parsed.message,
        laneId: parsed.laneId,
        agentId: parsed.agentId,
        stationId: parsed.stationId,
        metadata: parsed.metadata,
        raw: parsed.raw,
      });

      if (running && emit) {
        emit(event);
      }

      return event;
    },
  };

  return assertAdapterContract(adapter);
}

/**
 * Basic parser pipeline:
 * 1) Try JSON line parsing.
 * 2) Fall back to key=value token parsing.
 *
 * @param {string} line
 * @returns {ParsedLogRecord|null}
 */
function parseLogLine(line) {
  if (typeof line !== 'string') {
    return null;
  }

  const trimmed = line.trim();
  if (trimmed === '') {
    return null;
  }

  const parsedJson = parseJsonObject(trimmed);
  if (parsedJson) {
    return fromStructuredObject(parsedJson, line);
  }

  return fromKeyValueLine(trimmed, line);
}

/**
 * @param {string} line
 * @returns {Record<string, unknown>|null}
 */
function parseJsonObject(line) {
  if (!line.startsWith('{') || !line.endsWith('}')) {
    return null;
  }

  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * @param {Record<string, unknown>} payload
 * @param {string} rawLine
 * @returns {ParsedLogRecord}
 */
function fromStructuredObject(payload, rawLine) {
  const metadata = {
    ...pickMetadata(payload.meta),
    ...pickMetadata(payload.metadata),
    ...extractObjectRemainder(payload),
  };

  return {
    timestamp: toString(payload.timestamp || payload.ts || payload.time),
    event: toString(payload.event || payload.type || payload.action),
    level: toString(payload.level || payload.severity),
    message: toString(payload.message || payload.msg),
    laneId: toString(payload.laneId || payload.lane || payload.lane_id),
    agentId: toString(payload.agentId || payload.agent || payload.agent_id),
    stationId: toString(
      payload.stationId ||
        payload.station ||
        payload.station_id ||
        payload.workspace
    ),
    metadata,
    raw: payload.raw || payload || rawLine,
  };
}

/**
 * @param {string} trimmedLine
 * @param {string} rawLine
 * @returns {ParsedLogRecord}
 */
function fromKeyValueLine(trimmedLine, rawLine) {
  let rest = trimmedLine;
  let timestamp;
  const timestampMatch = rest.match(ISO_PREFIX_PATTERN);
  if (timestampMatch) {
    timestamp = timestampMatch[1];
    rest = timestampMatch[2];
  }

  const entries = parseKeyValuePairs(rest);
  const known = {
    timestamp,
    event: toString(entries.event || entries.type || entries.action),
    level: toString(entries.level || entries.severity),
    message: toString(entries.message || entries.msg),
    laneId: toString(entries.laneId || entries.lane || entries.lane_id),
    agentId: toString(entries.agentId || entries.agent || entries.agent_id),
    stationId: toString(
      entries.stationId ||
        entries.station ||
        entries.station_id ||
        entries.workspace
    ),
  };

  const remainder = rest.replace(KV_PAIR_PATTERN, ' ').replace(/\s+/g, ' ').trim();
  if (!known.message) {
    known.message = remainder;
  }
  if (!known.event) {
    known.event = inferEventType(known.message, entries);
  }

  return {
    timestamp: known.timestamp,
    event: known.event,
    level: known.level,
    message: known.message,
    laneId: known.laneId,
    agentId: known.agentId,
    stationId: known.stationId,
    metadata: extractEntryRemainder(entries),
    raw: rawLine,
  };
}

/**
 * @param {string} text
 * @returns {Record<string, string|number|boolean>}
 */
function parseKeyValuePairs(text) {
  /** @type {Record<string, string|number|boolean>} */
  const output = {};
  let match;

  KV_PAIR_PATTERN.lastIndex = 0;
  while ((match = KV_PAIR_PATTERN.exec(text)) !== null) {
    const key = match[1];
    const token = match[2];
    output[key] = coerceScalar(unquote(token));
  }

  return output;
}

/**
 * @param {string|undefined} value
 * @returns {string|undefined}
 */
function toString(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized === '' ? undefined : normalized;
}

/**
 * @param {Record<string, unknown>|undefined} value
 * @returns {Record<string, string|number|boolean|null>}
 */
function pickMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  /** @type {Record<string, string|number|boolean|null>} */
  const metadata = {};
  for (const [key, raw] of Object.entries(value)) {
    metadata[key] = normalizeMetadataValue(raw);
  }

  return metadata;
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, string|number|boolean|null>}
 */
function extractObjectRemainder(payload) {
  /** @type {Record<string, string|number|boolean|null>} */
  const remainder = {};
  for (const [key, value] of Object.entries(payload)) {
    if (KNOWN_KEYS.has(key)) {
      continue;
    }
    remainder[key] = normalizeMetadataValue(value);
  }
  return remainder;
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {Record<string, string|number|boolean|null>}
 */
function extractEntryRemainder(payload) {
  /** @type {Record<string, string|number|boolean|null>} */
  const remainder = {};
  for (const [key, value] of Object.entries(payload)) {
    if (KNOWN_KEYS.has(key)) {
      continue;
    }
    remainder[key] = normalizeMetadataValue(value);
  }
  return remainder;
}

/**
 * @param {string} token
 * @returns {string}
 */
function unquote(token) {
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return token.slice(1, -1).replace(/\\(["'])/g, '$1');
    }
  }
  return token;
}

/**
 * @param {string} value
 * @returns {string|number|boolean}
 */
function coerceScalar(value) {
  const trimmed = value.trim();
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
  }
  return trimmed;
}

/**
 * @param {unknown} value
 * @returns {string|number|boolean|null}
 */
function normalizeMetadataValue(value) {
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

/**
 * @param {string|undefined} message
 * @param {Record<string, unknown>} entries
 * @returns {string}
 */
function inferEventType(message, entries) {
  if (typeof entries.event === 'string' && entries.event.trim() !== '') {
    return entries.event;
  }

  const lower = String(message || '').toLowerCase();
  if (lower.includes('approval')) {
    return 'exec.approval';
  }
  if (lower.includes('enqueue') || lower.includes('queued')) {
    return 'lane.enqueue';
  }
  if (lower.includes('tool') && lower.includes('start')) {
    return 'tool.start';
  }
  if (lower.includes('tool') && lower.includes('stop')) {
    return 'tool.stop';
  }
  return 'telemetry.log';
}

module.exports = {
  createLogTailAdapter,
  parseLogLine,
};
