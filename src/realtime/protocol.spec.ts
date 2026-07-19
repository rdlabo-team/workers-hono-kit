import { describe, expect, it } from 'vitest';
import { parseRealtimeWebSocketProtocolOffer, parseWebSocketProtocols } from './protocol.js';

describe('realtime WebSocket protocol parsing', () => {
  it('splits and trims offered protocols', () => {
    expect(parseWebSocketProtocols(' app-v1, auth.token ,, client.id ')).toEqual([
      'app-v1',
      'auth.token',
      'client.id',
    ]);
  });

  it('extracts a valid authenticated offer', () => {
    expect(
      parseRealtimeWebSocketProtocolOffer('app-v1, auth.jwt, client.tab_1', {
        protocol: 'app-v1',
        authPrefix: 'auth.',
        clientPrefix: 'client.',
      }),
    ).toEqual({
      protocols: ['app-v1', 'auth.jwt', 'client.tab_1'],
      authToken: 'jwt',
      clientId: 'tab_1',
    });
  });

  it('rejects missing auth and invalid client IDs', () => {
    const options = { protocol: 'app-v1', authPrefix: 'auth.', clientPrefix: 'client.' };
    expect(parseRealtimeWebSocketProtocolOffer('app-v1, client.ok', options)).toBeNull();
    expect(parseRealtimeWebSocketProtocolOffer('app-v1, auth.jwt, client.bad.value', options)).toBeNull();
  });

  it('supports public endpoints without an auth protocol', () => {
    expect(
      parseRealtimeWebSocketProtocolOffer('app-v1, client.public', {
        protocol: 'app-v1',
        clientPrefix: 'client.',
        requireAuth: false,
      }),
    ).toEqual({ protocols: ['app-v1', 'client.public'], authToken: undefined, clientId: 'public' });
  });
});
