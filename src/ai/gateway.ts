/**
 * Cloudflare AI Gateway のプロバイダ生成（`ai` SDK + `ai-gateway-provider`）。
 * フリート共通 = foodlabel / winecode / receptray hono の AI 呼び出しを必ず Gateway 経由にする。
 *
 * `createAiGateway` が返す wrapper で `@ai-sdk/*` のモデルを包むと、SDK が組み立てた
 * プロバイダ宛リクエスト（api.openai.com / api.anthropic.com / *-aiplatform.googleapis.com 等）を
 * AI Gateway の Universal Endpoint 経由に差し替える。OpenAI / Anthropic / Google Vertex(SA) の
 * いずれも同じ `aigateway(model)` で透過的にルーティングされる（Vertex も対応）。
 *
 * ここはインフラ層（Gateway 識別子と認証トークンの注入だけ）。プロバイダの API キーや
 * Vertex の SA 認証情報は各 repo 側でモデル生成時に渡す（pass-through）。
 */
import { createAiGateway } from 'ai-gateway-provider';
import type { AiGateway, AiGatewayBindingSettings, AiGatewayOptions } from 'ai-gateway-provider';

export type { AiGateway, AiGatewayOptions } from 'ai-gateway-provider';

/** Workers の AI binding（`env.AI.gateway(name)`）の最小形。Cloudflare の `AiGateway` が構造的に適合する。 */
export type AiGatewayBinding = AiGatewayBindingSettings['binding'];

/**
 * AI Gateway 設定。2 系統:
 *  - binding 形: Workers ランタイム（本番 / `wrangler dev`）。`env.AI.gateway(name)` を渡す。
 *    binding 経由は同一アカウント内で事前認証されるため Gateway トークン不要。
 *  - REST 形: Workers 外（Node の eval ハーネス等、binding 不可）。accountId + gateway + token で REST。
 */
export type AiGatewayConfig =
  | {
      /** `env.AI.gateway(name)` 等の AI Gateway binding。 */
      binding: AiGatewayBinding;
      /** キャッシュ / リトライ / メタデータ等の Gateway オプション（任意）。 */
      options?: AiGatewayOptions;
    }
  | {
      /** Cloudflare アカウント ID。 */
      accountId: string;
      /** AI Gateway 名。 */
      gateway: string;
      /**
       * `cf-aig-authorization` に載せる Gateway 認証トークン。Authenticated Gateway のときだけ必要。
       * unauthenticated Gateway では省略可（プロバイダの API キーではなく Gateway 自体への認証）。
       */
      token?: string;
      /** キャッシュ / リトライ / メタデータ等の Gateway オプション（任意）。 */
      options?: AiGatewayOptions;
    };

export interface AiGatewayProvider {
  /**
   * `@ai-sdk/*` のモデルを包んで AI Gateway 経由にする。
   * 例: `aigateway(createAnthropic({ apiKey }).('claude-...'))`。
   * 配列を渡すとフォールバック（先頭から順に試行）になる。
   */
  aigateway: AiGateway;
}

/**
 * AI Gateway 用のプロバイダを生成する。binding 形 / REST 形のどちらでも可（欠落時は fail-fast）。
 */
export function createAiGatewayProvider(config: AiGatewayConfig): AiGatewayProvider {
  if ('binding' in config) {
    return { aigateway: createAiGateway({ binding: config.binding, options: config.options }) };
  }

  if (!config.accountId) {
    throw new Error('AI Gateway: accountId が未設定です');
  }
  if (!config.gateway) {
    throw new Error('AI Gateway: gateway 名が未設定です');
  }

  // token は Authenticated Gateway のときだけ apiKey として送る。unauthenticated では undefined で可。
  return {
    aigateway: createAiGateway({
      accountId: config.accountId,
      gateway: config.gateway,
      apiKey: config.token,
      options: config.options,
    }),
  };
}
