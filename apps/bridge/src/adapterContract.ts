import type { BridgeAdapter } from "./types.ts";

export function assertAdapterContract<TAdapter extends BridgeAdapter>(
  adapter: TAdapter,
): TAdapter {
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError("Bridge adapter must be an object.");
  }

  if (typeof adapter.name !== "string" || adapter.name.trim() === "") {
    throw new TypeError('Bridge adapter must define a non-empty string "name".');
  }

  if (typeof adapter.start !== "function") {
    throw new TypeError(`Bridge adapter "${adapter.name}" must implement start(handler).`);
  }

  if (typeof adapter.stop !== "function") {
    throw new TypeError(`Bridge adapter "${adapter.name}" must implement stop().`);
  }

  return adapter;
}
