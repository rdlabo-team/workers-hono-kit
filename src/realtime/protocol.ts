/** Parsed WebSocket subprotocol offer used by authenticated realtime endpoints. */
export interface RealtimeWebSocketProtocolOffer {
  protocols: string[];
  authToken?: string;
  clientId?: string;
}

/** Options for validating an application/auth/client WebSocket subprotocol offer. */
export interface ParseRealtimeWebSocketProtocolOptions {
  protocol: string;
  authPrefix?: string;
  clientPrefix: string;
  requireAuth?: boolean;
  clientIdPattern?: RegExp;
}

/** Split a `Sec-WebSocket-Protocol` header into trimmed, non-empty protocol tokens. */
export function parseWebSocketProtocols(header: string | undefined): string[] {
  return (header ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Validate the standard application/auth/client WebSocket subprotocol offer.
 *
 * Returns `null` when the application protocol, required auth token, or client ID is invalid.
 */
export function parseRealtimeWebSocketProtocolOffer(
  header: string | undefined,
  options: ParseRealtimeWebSocketProtocolOptions,
): RealtimeWebSocketProtocolOffer | null {
  const protocols = parseWebSocketProtocols(header);
  if (!protocols.includes(options.protocol)) {
    return null;
  }

  const authPrefix = options.authPrefix;
  const authToken = authPrefix
    ? protocols.find((value) => value.startsWith(authPrefix))?.slice(authPrefix.length)
    : undefined;
  if ((options.requireAuth ?? true) && !authToken) {
    return null;
  }

  const clientId = protocols
    .find((value) => value.startsWith(options.clientPrefix))
    ?.slice(options.clientPrefix.length);
  const clientIdPattern = options.clientIdPattern ?? /^[A-Za-z0-9_-]{1,64}$/;
  if (clientId !== undefined && !clientIdPattern.test(clientId)) {
    return null;
  }

  return { protocols, authToken, clientId };
}
