import { describe, expect, it, vi } from 'vitest';
import {
  acknowledgeHibernationWebSocketClose,
  broadcastHibernationWebSockets,
  configureHibernationAutoResponse,
  upgradeHibernationWebSocket,
} from './hibernation.js';
import type { HibernationWebSocketLike, HibernationWebSocketStateLike } from './hibernation.js';

function socket(): HibernationWebSocketLike {
  return {
    send: vi.fn(),
    close: vi.fn(),
    serializeAttachment: vi.fn(),
  } as unknown as HibernationWebSocketLike;
}

describe('Hibernation WebSocket helpers', () => {
  it('configures runtime ping/pong without an alarm', () => {
    const setWebSocketAutoResponse = vi.fn();
    class Pair {
      constructor(
        readonly request: string,
        readonly response: string,
      ) {}
    }
    configureHibernationAutoResponse({
      state: { setWebSocketAutoResponse } as unknown as HibernationWebSocketStateLike,
      ping: 'ping',
      pong: 'pong',
      pairFactory: Pair,
    });
    expect(setWebSocketAutoResponse).toHaveBeenCalledWith(
      expect.objectContaining({ request: 'ping', response: 'pong' }),
    );
  });

  it('serializes attachment before accepting the server socket', () => {
    const client = socket();
    const server = socket();
    const order: string[] = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- WebSocket test double uses function properties.
    vi.mocked(server.serializeAttachment).mockImplementation(() => order.push('serialize'));
    const state = {
      acceptWebSocket: vi.fn(() => order.push('accept')),
    } as unknown as HibernationWebSocketStateLike;
    class Pair {
      0 = client;
      1 = server;
    }
    const expected = new Response(null, { status: 204 });
    const response = upgradeHibernationWebSocket({
      state,
      request: new Request('https://do/connect', { headers: { Upgrade: 'websocket' } }),
      protocol: 'realtime-v1',
      attachment: { clientId: 'client-1' },
      pairFactory: Pair,
      responseFactory: (selectedClient, protocol) => {
        expect(selectedClient).toBe(client);
        expect(protocol).toBe('realtime-v1');
        return expected;
      },
    });
    expect(response).toBe(expected);
    expect(order).toEqual(['serialize', 'accept']);
  });

  it('rejects non-WebSocket requests before creating a pair', () => {
    const Pair = vi.fn();
    const response = upgradeHibernationWebSocket({
      state: {} as HibernationWebSocketStateLike,
      request: new Request('https://do/connect'),
      protocol: 'realtime-v1',
      pairFactory: Pair as never,
    });
    expect(response.status).toBe(426);
    expect(Pair).not.toHaveBeenCalled();
  });

  it('broadcasts JSON and closes only a failed socket', () => {
    const healthy = socket();
    const failed = socket();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- WebSocket test double uses function properties.
    vi.mocked(failed.send).mockImplementation(() => {
      throw new Error('gone');
    });
    broadcastHibernationWebSockets({ getWebSockets: () => [healthy, failed] }, [{ topic: 'changed' }]);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- WebSocket test double uses function properties.
    expect(healthy.send).toHaveBeenCalledWith('[{"topic":"changed"}]');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- WebSocket test double uses function properties.
    expect(failed.close).toHaveBeenCalledWith(1011, 'publish failed');
  });

  it('normalizes reserved peer close codes', () => {
    const peer = socket();
    acknowledgeHibernationWebSocketClose(peer, 1006, 'abnormal');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- WebSocket test double uses function properties.
    expect(peer.close).toHaveBeenCalledWith(1000, 'abnormal');
  });
});
