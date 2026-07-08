import type { Env } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { Connection } from 'mysql2/promise';
import type { ExecutionContextLike } from '../http/execution-context.js';
import { withMysqlConnections, type HyperdriveLike } from '../db/connection.js';

/** Inputs available while building a per-request application container. */
export interface ContainerBuildContext<TEnv extends Env['Bindings']> {
  env: TEnv;
  executionCtx: ExecutionContextLike;
  primary: Connection;
  replica: Connection;
}

/** Options for {@link createContainerRuntime}. */
export interface ContainerRuntimeOptions<TEnv extends Env['Bindings'], TContainer> {
  /** Resolve Hyperdrive bindings from Worker env. */
  hyperdrives: (env: TEnv) => { primary: HyperdriveLike; replica: HyperdriveLike };
  /** Forwarded to {@link withMysqlConnections} (e.g. `{ dateStrings: true }`). */
  connectionOptions?: Record<string, unknown>;
  /** Build the request-scoped container after primary/replica connections are open. */
  createContainer: (ctx: ContainerBuildContext<TEnv>) => TContainer | Promise<TContainer>;
}

/** Pair returned by {@link createContainerRuntime}. */
export interface ContainerRuntime<TEnv extends Env['Bindings'], TContainer> {
  /** Hono middleware: `c.set('container', …)` then `next()`. Honors test overrides. */
  middleware: (overrides?: { container?: TContainer }) => MiddlewareHandler<{
    Bindings: TEnv;
    Variables: { container: TContainer };
  }>;
  /** Shared entry for `scheduled` / `queue` handlers (same connection lifecycle as middleware). */
  withContainer: <T>(
    env: TEnv,
    executionCtx: ExecutionContextLike,
    fn: (container: TContainer) => Promise<T>,
  ) => Promise<T>;
}

/**
 * Standard singleton-app container wiring: per-request Hyperdrive connections + `c.set('container')`.
 *
 * @remarks
 * Isolate-scoped memoization (secrets, env) stays in the app via {@link createIsolateMemo} inside
 * `createContainer` or a helper it calls — this factory only owns the per-request DB lifecycle.
 */
export function createContainerRuntime<TEnv extends Env['Bindings'], TContainer>(
  options: ContainerRuntimeOptions<TEnv, TContainer>,
): ContainerRuntime<TEnv, TContainer> {
  const withContainer = async <T>(
    env: TEnv,
    executionCtx: ExecutionContextLike,
    fn: (container: TContainer) => Promise<T>,
  ): Promise<T> =>
    withMysqlConnections(
      options.hyperdrives(env),
      executionCtx,
      async ({ primary, replica }) => {
        const container = await options.createContainer({ env, executionCtx, primary, replica });
        return fn(container);
      },
      options.connectionOptions,
    );

  const middleware = (overrides?: { container?: TContainer }) =>
    (async (c, next) => {
      if (overrides?.container) {
        c.set('container', overrides.container);
        await next();
        return;
      }

      await withContainer(c.env, c.executionCtx, async (container) => {
        c.set('container', container);
        await next();
      });
    }) as MiddlewareHandler<{ Bindings: TEnv; Variables: { container: TContainer } }>;

  return { middleware, withContainer };
}
