import type { MiddlewareHandler } from 'hono';

/**
 * Minimal shape of a Workers Analytics Engine dataset binding.
 *
 * Declared locally so consumers are not forced to depend on `@cloudflare/workers-types`. Only the
 * single write operation the emitter needs is modeled. A real `AnalyticsEngineDataset` binding is
 * assignable. Writes are non-blocking and add no latency to the request.
 *
 * @see https://developers.cloudflare.com/analytics/analytics-engine/
 */
export interface AnalyticsEngineDatasetLike {
  writeDataPoint(event: { doubles?: number[]; blobs?: (string | null)[]; indexes?: string[] }): void;
}

/** Options for {@link perfLog}. Both sinks are optional; enable either or both. */
export interface PerfLogOptions {
  /**
   * When `true`, emit one `console.log(JSON.stringify({ perf }))` per request. With
   * `[observability] enabled = true` these lines are captured by **Workers Logs** (retained up to
   * 7 days, queryable via the dashboard Query Builder or the Observability REST API) — no live
   * `wrangler tail` needed, which is what makes this practical for low-traffic Workers.
   *
   * Explicit wins over the `PERF_LOG` env fallback in both directions: `true` forces on, `false` forces
   * off (even when `PERF_LOG === '1'`), `undefined` (default) defers to `PERF_LOG`.
   */
  console?: boolean;
  /**
   * When provided, write one data point per request to a **Workers Analytics Engine** dataset. Query
   * percentiles by route/colo with the SQL API (≈90-day retention). Non-blocking. Layout:
   * `doubles = [t_app_ms, cold(0|1), status]`, `blobs = [path, colo, method]`, `indexes = [path]`.
   */
  dataset?: AnalyticsEngineDatasetLike;
  /**
   * In-code sampling in `[0, 1]` (default `1` = every request; values are clamped to the range).
   * Thins **Analytics Engine writes only** — Workers Logs volume is controlled separately by the
   * observability `head_sampling_rate`. Low-traffic Workers should leave it at `1`.
   */
  sampleRate?: number;
}

// `t_app` = wall time inside the Hono app (this middleware wrapping `next()`), i.e. everything from
// the middlewares/auth guards through the route handler. On a DB-round-trip-bound Worker it is
// dominated by database round trips, so it is the signal that exposes edge↔origin distance (Smart
// Placement) and serial-await fan-out.
//
// SCOPE DEPENDS ON WIRING. Whatever runs *inside* the app is included, whatever runs in `fetch`
// *before* the app is not. If the app builds its container/secrets/DB connection as an in-app
// middleware (e.g. secrets fetch + Hyperdrive connect inside `createApp`), those costs land in the
// cold `t_app`; if the container is built in `fetch` before `createApp(...).fetch(req)`, they do not.
// So the cold-row `t_app` is NOT directly comparable across repos wired differently — document the
// wiring per repo, or add a scope label, before comparing cold numbers.
//
// Note: on production Workers `Date.now()` only advances at I/O boundaries (Spectre mitigation), so
// `t_app` ≈ I/O wait, not CPU time — which is what you want for round-trip-bound analysis.
//
// Module scope: survives for the isolate's lifetime, so the first request after a cold start reports
// `cold: true` and later requests `cold: false`. Caveat: requests that arrive concurrently right after
// a cold start are labelled warm (only the very first flips the flag) even though they pay cold-init
// waits — a minor warm-side contamination, negligible at the low request rates this targets.
let isolateWarm = false;

/**
 * Create a Hono middleware that records a per-request latency data point and emits it to Workers
 * Logs (`console`) and/or Workers Analytics Engine (`dataset`).
 *
 * Register it first (`app.use('*', perfLog(...))`) so `t_app` covers the whole in-app path. Route
 * grouping uses the matched route pattern (e.g. `/user/:id`) rather than the raw path so ids do not
 * explode cardinality; unmatched requests collapse to `(unmatched)`. Colo comes from `request.cf.colo`;
 * cold/warm from an isolate-scoped flag. See {@link PerfLogOptions} for the two sinks and the note
 * above for exactly what `t_app` includes (it depends on where secrets/DB-connect are wired).
 *
 * Two wiring styles, both A/B-capable (Workers Logs and/or Analytics Engine):
 *
 * @example Bare, when the app is served with `app.fetch(req, env, ctx)` — reads `PERF` (Analytics
 * Engine binding) and `PERF_LOG === '1'` (Workers Logs) straight off `c.env`:
 * ```ts
 * app.use('*', perfLog());
 * ```
 *
 * @example Explicit, when the app is built without Hono `env` (e.g. `createApp(container).fetch(req)`)
 * — thread the bindings in:
 * ```ts
 * app.use('*', perfLog({ console: env.PERF_LOG === '1', dataset: env.PERF }));
 * ```
 *
 * @example Query Analytics Engine (SQL API), handler p50/p90 by route and colo:
 * ```sql
 * SELECT blob1 AS path, blob2 AS colo,
 *        quantileWeighted(0.5)(double1, _sample_interval) AS p50,
 *        quantileWeighted(0.9)(double1, _sample_interval) AS p90,
 *        sum(_sample_interval) AS n
 * FROM your_dataset WHERE timestamp > now() - INTERVAL '7' DAY
 * GROUP BY path, colo ORDER BY n DESC
 * ```
 */
export function perfLog(options: PerfLogOptions = {}): MiddlewareHandler {
  const { console: toConsole, dataset, sampleRate = 1 } = options;
  const rate = Math.min(1, Math.max(0, sampleRate)); // clamp so out-of-range values can't invert sampling

  return async (c, next) => {
    const cold = !isolateWarm;
    isolateWarm = true;

    const start = Date.now();
    await next();
    const tApp = Date.now() - start;

    // Resolve sinks. Both are independently overridable: an explicit option wins, otherwise fall back
    // to bindings on `c.env` (populated when the app is served with `app.fetch(req, env, ctx)`), so a
    // bare `perfLog()` still works. `PERF` = Analytics Engine dataset binding; `PERF_LOG === '1'` turns
    // on Workers Logs. `console: false` explicitly disables Workers Logs even when `PERF_LOG` is set.
    const envBindings = c.env as { PERF?: AnalyticsEngineDatasetLike; PERF_LOG?: string } | undefined;
    const sink = dataset ?? envBindings?.PERF;
    const emitConsole = toConsole !== undefined ? toConsole : envBindings?.PERF_LOG === '1';
    if (!sink && !emitConsole) {
      return;
    }

    // Matched route pattern keeps cardinality low (`/user/:id`, not `/user/4821`). Use the deprecated
    // `c.req.routePath` (not `routePath(c)` from `hono/route`) so the middleware works across the whole
    // `hono` peer range `^4.6.0` — `hono/route` only exists on newer hono and would break the floor.
    // Unmatched requests (404 / bot scans) collapse to a single label so they cannot explode cardinality.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- routePath(c) needs hono ≥4.8; peer floor is 4.6
    const matched = c.req.routePath;
    const path = matched && matched !== '/*' ? matched : '(unmatched)';
    const colo = (c.req.raw as { cf?: { colo?: string } }).cf?.colo ?? '-';
    const method = c.req.method;
    const status = c.res.status;

    // In-code sampling thins Analytics Engine writes only; Workers Logs volume is controlled separately
    // by the observability `head_sampling_rate`. Low-traffic Workers should leave `sampleRate` at 1.
    if (sink && (rate >= 1 || Math.random() < rate)) {
      sink.writeDataPoint({
        doubles: [tApp, cold ? 1 : 0, status],
        blobs: [path, colo, method],
        indexes: [path],
      });
    }

    if (emitConsole) {
      console.log(JSON.stringify({ perf: { cold, colo, method, path, status, t_app: tApp } }));
    }
  };
}
