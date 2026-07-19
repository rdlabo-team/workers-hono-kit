/** Minimal Durable Object namespace needed by the legacy SSE bridge. */
export interface RealtimeDurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): {
    fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  };
}

interface LegacyClientWebSocket extends WebSocket {
  accept(): void;
}

interface UpgradeResponse extends Response {
  webSocket: LegacyClientWebSocket | null;
}

/** Options for bridging legacy SSE clients to Hibernation WebSocket rooms. */
export interface LegacySseBridgeOptions {
  namespace: RealtimeDurableObjectNamespaceLike;
  roomNames: readonly string[];
  signal: AbortSignal;
  protocol: string;
  clientId?: string;
  heartbeatMs?: number;
  pong?: string;
  connectUrl?: string;
}

/**
 * Bridge legacy SSE clients to one or more Hibernation WebSocket rooms.
 *
 * The heartbeat lives in the outer Worker only; Durable Objects remain hibernatable. Aborting the
 * downstream request also aborts pending upgrades, including the late-upgrade race during teardown.
 */
export function createLegacySseBridge(options: LegacySseBridgeOptions): Response {
  const encoder = new TextEncoder();
  const sockets = new Set<LegacyClientWebSocket>();
  const heartbeatMs = options.heartbeatMs ?? 25_000;
  const pong = options.pong ?? 'pong';
  const connectUrl = options.connectUrl ?? 'https://do/connect';
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closeStream: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const upstreamAbort = new AbortController();
      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        upstreamAbort.abort();
        if (heartbeat) {
          clearInterval(heartbeat);
        }
        for (const socket of sockets) {
          try {
            socket.close(1000, 'legacy SSE closed');
          } catch {
            // already closed
          }
        }
        sockets.clear();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      closeStream = close;

      if (options.signal.aborted) {
        close();
        return;
      }
      options.signal.addEventListener('abort', close, { once: true });
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode('event: ping\ndata: ping\n\n'));
        } catch {
          close();
        }
      }, heartbeatMs);

      const connect = async (roomName: string): Promise<void> => {
        const id = options.namespace.idFromName(roomName);
        const response = (await options.namespace.get(id).fetch(connectUrl, {
          signal: upstreamAbort.signal,
          headers: {
            Upgrade: 'websocket',
            'Sec-WebSocket-Protocol': options.protocol,
            ...(options.clientId ? { 'x-client-id': options.clientId } : {}),
          },
        })) as UpgradeResponse;
        const socket = response.webSocket;
        if (response.status !== 101 || !socket) {
          socket?.close(1011, 'legacy SSE upgrade failed');
          throw new Error('Legacy realtime WebSocket upgrade failed');
        }
        if (closed) {
          socket.close(1000, 'legacy SSE already closed');
          return;
        }
        sockets.add(socket);
        socket.accept();
        socket.addEventListener('message', ({ data }) => {
          if (typeof data !== 'string' || data === pong) {
            return;
          }
          try {
            const parsed: unknown = JSON.parse(data);
            for (const event of Array.isArray(parsed) ? parsed : [parsed]) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
          } catch {
            // Ignore malformed upstream messages.
          }
        });
        socket.addEventListener('close', close, { once: true });
        socket.addEventListener('error', close, { once: true });
      };

      void Promise.all(options.roomNames.map((roomName) => connect(roomName))).catch(close);
    },
    cancel() {
      closeStream?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
