const SAFE_CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface ResolvedClientId {
  readonly clientId: string;
  readonly reconnect: boolean;
}

export function normalizeClientId(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!SAFE_CLIENT_ID_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

export function parseRequestedClientId(rawUrl: string | undefined): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(rawUrl, "http://localhost");
    return normalizeClientId(parsedUrl.searchParams.get("clientId"));
  } catch {
    return null;
  }
}

export function resolveClientId(
  requestedClientId: string | null,
  activeClientIds: ReadonlySet<string>,
  idFactory: () => string,
): ResolvedClientId {
  if (requestedClientId !== null) {
    return {
      clientId: requestedClientId,
      reconnect: activeClientIds.has(requestedClientId),
    };
  }

  let generatedId = idFactory();
  while (activeClientIds.has(generatedId)) {
    generatedId = idFactory();
  }

  return {
    clientId: generatedId,
    reconnect: false,
  };
}
