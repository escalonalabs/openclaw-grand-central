/**
 * @typedef {import('./types').BridgeAdapter} BridgeAdapter
 */

/**
 * Runtime guard for the bridge adapter contract.
 *
 * @param {BridgeAdapter} adapter
 * @returns {BridgeAdapter}
 */
function assertAdapterContract(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Bridge adapter must be an object.');
  }

  if (typeof adapter.name !== 'string' || adapter.name.trim() === '') {
    throw new TypeError('Bridge adapter must define a non-empty string "name".');
  }

  if (typeof adapter.start !== 'function') {
    throw new TypeError(`Bridge adapter "${adapter.name}" must implement start(handler).`);
  }

  if (typeof adapter.stop !== 'function') {
    throw new TypeError(`Bridge adapter "${adapter.name}" must implement stop().`);
  }

  return adapter;
}

module.exports = {
  assertAdapterContract,
};
