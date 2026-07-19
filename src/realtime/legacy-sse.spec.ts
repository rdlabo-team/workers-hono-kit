import { describe, expect, it, vi } from 'vitest';
import { createLegacySseBridge } from './legacy-sse.js';
import type { RealtimeDurableObjectNamespaceLike } from './legacy-sse.js';

class FakeSocket extends EventTarget {
  readonly accept = vi.fn();
  readonly close = vi.fn();
}

function upgrade(socket: FakeSocket): Response {
  return { status: 101, webSocket: socket } as unknown as Response;
}

describe('createLegacySseBridge', () => {
  it('accepts a namespace with a concrete Durable Object ID type', () => {
    interface ConcreteId {
      value: string;
    }
    const namespace: RealtimeDurableObjectNamespaceLike<ConcreteId> = {
      idFromName: (name) => ({ value: name }),
      get: () => ({ fetch: () => Promise.resolve({ status: 500, webSocket: null } as unknown as Response) }),
    };
    const response = createLegacySseBridge({
      namespace,
      roomNames: [],
      signal: new AbortController().signal,
      protocol: 'realtime-v1',
    });
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('fans out upstream JSON messages as SSE data frames', async () => {
    const socket = new FakeSocket();
    const namespace = {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => ({ fetch: vi.fn(() => Promise.resolve(upgrade(socket))) })),
    } as unknown as RealtimeDurableObjectNamespaceLike;
    const response = createLegacySseBridge({
      namespace,
      roomNames: ['group:1'],
      signal: new AbortController().signal,
      protocol: 'realtime-v1',
    });
    await Promise.resolve();
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify([{ topic: 'one' }, { topic: 'two' }]) }));
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(first.value).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(first.value as Uint8Array)).toBe('data: {"topic":"one"}\n\n');
    await reader.cancel();
    expect(socket.accept).toHaveBeenCalledOnce();
  });

  it('aborts an in-flight upgrade and closes a socket that arrives late', async () => {
    let resolveUpgrade!: (response: Response) => void;
    let seenSignal: AbortSignal | undefined;
    const socket = new FakeSocket();
    const namespace = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (_input: string | URL | Request, init?: RequestInit) => {
          seenSignal = init?.signal ?? undefined;
          return new Promise<Response>((resolve) => {
            resolveUpgrade = resolve;
          });
        },
      }),
    } as RealtimeDurableObjectNamespaceLike;
    const downstream = new AbortController();
    createLegacySseBridge({
      namespace,
      roomNames: ['user:1'],
      signal: downstream.signal,
      protocol: 'realtime-v1',
    });
    downstream.abort();
    expect(seenSignal?.aborted).toBe(true);
    resolveUpgrade(upgrade(socket));
    await Promise.resolve();
    await Promise.resolve();
    expect(socket.accept).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledWith(1000, 'legacy SSE already closed');
  });
});
