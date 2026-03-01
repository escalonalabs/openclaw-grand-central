const { assertAdapterContract } = require('./contract');
const { normalizeStationEvent } = require('./normalize');

/**
 * @typedef {import('./types').BridgeEventEmitter} BridgeEventEmitter
 * @typedef {import('./types').PluginAdapter} PluginAdapter
 */

/**
 * Plugin adapter stub.
 *
 * TODO: replace `emitPluginEvent` input contract with the real OpenClaw plugin
 * payload schema once plugin transport is wired in production.
 *
 * @param {{source?: string}=} options
 * @returns {PluginAdapter}
 */
function createPluginAdapter(options = {}) {
  const source =
    typeof options.source === 'string' && options.source.trim() !== ''
      ? options.source.trim()
      : 'plugin-stub';

  /** @type {BridgeEventEmitter|null} */
  let emit = null;
  let running = false;

  const adapter = {
    name: 'plugin',
    kind: 'plugin-stub',

    /**
     * @param {BridgeEventEmitter} handler
     */
    async start(handler) {
      if (typeof handler !== 'function') {
        throw new TypeError('plugin adapter start(handler) requires a function.');
      }
      emit = handler;
      running = true;
    },

    async stop() {
      running = false;
      emit = null;
    },

    /**
     * Callable stub for future plugin event ingestion.
     *
     * @param {Record<string, unknown>} payload
     * @returns {{stub: true, reason: string, event: import('./types').StationEvent}}
     */
    emitPluginEvent(payload = {}) {
      const event = normalizeStationEvent({
        source,
        timestamp: payload.timestamp || payload.ts || payload.time,
        event: payload.event || payload.type || 'plugin.todo',
        level: payload.level || 'info',
        message:
          payload.message ||
          'plugin adapter stub: payload accepted, transport not wired yet',
        laneId: payload.laneId || payload.lane,
        agentId: payload.agentId || payload.agent,
        stationId: payload.stationId || payload.station || payload.workspace,
        metadata: {
          ...(typeof payload.metadata === 'object' && payload.metadata
            ? payload.metadata
            : {}),
          stub: true,
        },
        raw: payload,
      });

      if (running && emit) {
        emit(event);
      }

      return {
        stub: true,
        reason: 'OpenClaw production plugin transport is not integrated in this MVP.',
        event,
      };
    },
  };

  return assertAdapterContract(adapter);
}

module.exports = {
  createPluginAdapter,
};
