/**
 * Trailing-slash normalization for NestJS(Express) → Hono parity.
 *
 * Express runs with strict routing off by default, so `/x` and `/x/` resolve to the same handler.
 * Hono distinguishes them, so a client that sends e.g. `GET /functions/timeline/` 404s against a
 * Hono worker that only registered `/functions/timeline`. Apply this at the Worker `fetch` entry to
 * strip a trailing slash before routing, preserving method / headers / body.
 *
 * We intentionally do NOT use `hono/trailing-slash`'s `trimTrailingSlash`, which responds with a 301
 * redirect and thus breaks non-GET methods (POST/PUT/DELETE) and clients that don't follow redirects.
 *
 * @example
 * export default {
 *   fetch: (request, env, ctx) => app.fetch(normalizeTrailingSlash(request), env, ctx),
 * };
 *
 * @param request - The incoming request.
 * @returns The same request when the path has no trailing slash (or is exactly `/`), otherwise a new
 *   Request with the trailing slash(es) removed.
 */
export const normalizeTrailingSlash = (request: Request): Request => {
  const url = new URL(request.url);
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
    return new Request(url, request);
  }
  return request;
};
