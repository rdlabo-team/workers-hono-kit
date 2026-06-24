import { describe, expect, it, vi } from 'vitest';
import { createAiGatewayProvider } from './gateway';

describe('createAiGatewayProvider', () => {
  const valid = { accountId: 'acc', gateway: 'gw', token: 'tok' };

  it('aigateway を返し、@ai-sdk モデルを包むと AI Gateway 用モデル(v3)になる', async () => {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { aigateway } = createAiGatewayProvider(valid);
    const model = aigateway(createAnthropic({ apiKey: 'x' })('claude-haiku-4-5-20251001'));
    expect(model.specificationVersion).toBe('v3');
    expect(model.modelId).toBe('claude-haiku-4-5-20251001');
  });

  it('配列を渡すとフォールバック構成のモデルになる', async () => {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { createOpenAI } = await import('@ai-sdk/openai');
    const { aigateway } = createAiGatewayProvider(valid);
    const model = aigateway([
      createAnthropic({ apiKey: 'x' })('claude-haiku-4-5-20251001'),
      createOpenAI({ apiKey: 'y' })('gpt-5.2'),
    ]);
    expect(model.specificationVersion).toBe('v3');
  });

  it('accountId / gateway が欠けると fail-fast する', () => {
    expect(() => createAiGatewayProvider({ ...valid, accountId: '' })).toThrow(/accountId/);
    expect(() => createAiGatewayProvider({ ...valid, gateway: '' })).toThrow(/gateway/);
  });

  it('REST 形は token 省略可（unauthenticated gateway）＝throw しない', async () => {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const { aigateway } = createAiGatewayProvider({ accountId: 'acc', gateway: 'gw' });
    const model = aigateway(createAnthropic({ apiKey: 'x' })('claude-haiku-4-5-20251001'));
    expect(model.specificationVersion).toBe('v3');
  });

  it('binding 形: doGenerate は binding.run を呼ぶ（global fetch も cf-aig トークンも使わない）', async () => {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const run = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cf-aig-step': '0' },
      }),
    );
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    try {
      const { generateText } = await import('ai');
      const { aigateway } = createAiGatewayProvider({ binding: { run } });
      await generateText({
        model: aigateway(createAnthropic({ apiKey: 'x' })('claude-haiku-4-5-20251001')),
        prompt: 'hi',
      }).catch(() => undefined);
      expect(run).toHaveBeenCalledTimes(1);
      // binding 経由は同一アカウント内で事前認証されるため global fetch は使わない。
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('doGenerate は AI Gateway の Universal Endpoint へ POST する（cf-aig-authorization 付き）', async () => {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cf-aig-step': '0' },
      }),
    );
    try {
      const { generateText } = await import('ai');
      const { aigateway } = createAiGatewayProvider(valid);
      await generateText({
        model: aigateway(createAnthropic({ apiKey: 'x' })('claude-haiku-4-5-20251001')),
        prompt: 'hi',
      }).catch(() => undefined);
      const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
      expect(url).toBe('https://gateway.ai.cloudflare.com/v1/acc/gw');
      const headers = new Headers(init?.headers);
      expect(headers.get('cf-aig-authorization')).toBe('Bearer tok');
    } finally {
      fetchMock.mockRestore();
    }
  });
});
