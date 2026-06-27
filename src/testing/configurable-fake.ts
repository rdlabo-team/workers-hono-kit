/**
 * 部分実装から test double を作る。設定済みメソッドはそのまま、未設定メソッドを呼ぶと
 * `${name}.${method} not configured` で明示的に失敗する。
 *
 * 各 repo の Fake*Gateway に散っていた「`Partial<impl>` を受け取り、未設定なら throw する手書き
 * クラス」の定型を一本化する。interface がドメインごとに異なる gateway（Stripe 等）でも、これで
 * 1 行で必要メソッドだけ差した fake を作れる:
 *
 *   const stripe = configurableFake<StripeGateway>(
 *     { listPaymentIntents: async () => fakeApiList([fakePaymentIntent()]) },
 *     'FakeStripeGateway',
 *   );
 */
export function configurableFake<T extends object>(impl: Partial<T>, name = 'fake'): T {
  return new Proxy(impl, {
    get(target, prop) {
      if (prop in target) {
        return (target as Record<string | symbol, unknown>)[prop];
      }
      // Promise インターロップ用プロパティには「未設定メソッド」関数を返さない。返すと fake 自身が
      // thenable 扱いされ、誤って await / Promise.resolve した瞬間に then() が呼ばれて throw する罠になる。
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return undefined;
      }
      if (typeof prop === 'string') {
        return () => {
          throw new Error(`${name}.${prop} not configured`);
        };
      }
      return undefined;
    },
  }) as T;
}
