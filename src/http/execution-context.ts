/**
 * Minimal structural shape of a Workers `ExecutionContext`, limited to `waitUntil`.
 *
 * @remarks
 * Declared structurally to avoid a dependency on `@cloudflare/workers-types`.
 * Lives in the root export path so worker entry modules can import it without pulling in `./db`.
 */
export interface ExecutionContextLike {
  /** Extend the request's lifetime until `promise` settles (used to close connections after the response). */
  waitUntil(promise: Promise<unknown>): void;
}
