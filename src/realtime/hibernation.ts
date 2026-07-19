/** Minimal Hibernation WebSocket state used by the shared helpers. */
export interface HibernationWebSocketStateLike {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): WebSocket[];
  setWebSocketAutoResponse(pair: unknown): void;
}

/** A server-side WebSocket that can persist metadata across Durable Object hibernation. */
export interface HibernationWebSocketLike extends WebSocket {
  serializeAttachment(value: unknown): void;
}

/** Constructor shape of the Workers `WebSocketPair` runtime global. */
export type WebSocketPairFactory = new () => {
  0: HibernationWebSocketLike;
  1: HibernationWebSocketLike;
};

/** Constructor shape of the Workers `WebSocketRequestResponsePair` runtime global. */
export type WebSocketAutoResponsePairFactory = new (request: string, response: string) => unknown;

/** Options for configuring runtime-handled ping/pong responses. */
export interface HibernationAutoResponseOptions {
  state: HibernationWebSocketStateLike;
  ping: string;
  pong: string;
  pairFactory?: WebSocketAutoResponsePairFactory;
}

/** Options for upgrading a request to a Hibernation WebSocket. */
export interface HibernationUpgradeOptions {
  state: HibernationWebSocketStateLike;
  request: Request;
  protocol: string;
  attachment?: unknown;
  pairFactory?: WebSocketPairFactory;
  responseFactory?: (client: WebSocket, protocol: string) => Response;
}

declare const WebSocketPair: WebSocketPairFactory;
declare const WebSocketRequestResponsePair: WebSocketAutoResponsePairFactory;

/** Configure ping/pong at the runtime layer so application heartbeats do not wake the object. */
export function configureHibernationAutoResponse(options: HibernationAutoResponseOptions): void {
  const Pair = options.pairFactory ?? WebSocketRequestResponsePair;
  options.state.setWebSocketAutoResponse(new Pair(options.ping, options.pong));
}

/**
 * Upgrade a request and register its server socket with the Hibernation WebSocket API.
 *
 * Attachments are serialized before acceptance so connection metadata remains available after
 * the Durable Object instance is evicted and reconstructed.
 */
export function upgradeHibernationWebSocket(options: HibernationUpgradeOptions): Response {
  if (options.request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected Upgrade: websocket', { status: 426 });
  }

  const Pair = options.pairFactory ?? WebSocketPair;
  const pair = new Pair();
  const client = pair[0];
  const server = pair[1];
  if (options.attachment !== undefined) {
    server.serializeAttachment(options.attachment);
  }
  options.state.acceptWebSocket(server);

  return options.responseFactory
    ? options.responseFactory(client, options.protocol)
    : new Response(null, {
        status: 101,
        webSocket: client,
        headers: { 'Sec-WebSocket-Protocol': options.protocol },
      } as ResponseInit & { webSocket: WebSocket });
}

/** Broadcast one JSON message to all sockets restored by `getWebSockets()`. */
export function broadcastHibernationWebSockets(
  state: Pick<HibernationWebSocketStateLike, 'getWebSockets'>,
  payload: unknown,
): void {
  const message = JSON.stringify(payload);
  for (const socket of state.getWebSockets()) {
    try {
      socket.send(message);
    } catch {
      closeHibernationWebSocket(socket, 1011, 'publish failed');
    }
  }
}

/** Close a Hibernation WebSocket while tolerating already-closed sockets. */
export function closeHibernationWebSocket(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // The socket is already closed or cannot send a close frame.
  }
}

/** Echo a peer close using a legal close-frame code. */
export function acknowledgeHibernationWebSocketClose(socket: WebSocket, code: number, reason: string): void {
  const replyCode = code === 1005 || code === 1006 || code === 1015 ? 1000 : code;
  closeHibernationWebSocket(socket, replyCode, reason);
}
