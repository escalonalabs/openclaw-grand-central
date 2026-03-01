const { assertAdapterContract } = require('./contract');
const { createLogTailAdapter, parseLogLine } = require('./log-tail-adapter');
const { normalizeStationEvent } = require('./normalize');
const { createPluginAdapter } = require('./plugin-adapter');

module.exports = {
  assertAdapterContract,
  createLogTailAdapter,
  createPluginAdapter,
  normalizeStationEvent,
  parseLogLine,
};
