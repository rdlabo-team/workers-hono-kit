import { toReplicaIsoDatetime } from './wire.js';

/**
 * A wall-clock provider returning the current instant.
 *
 * Inject this dependency in tests instead of mocking the global `Date`.
 */
export type ReplicaClock = () => Date;

/** System wall clock used by offline replica helpers by default. */
export const systemReplicaClock: ReplicaClock = () => new Date();

/**
 * Read the current wall-clock instant in canonical replica wire form.
 *
 * @param clock - Injectable clock; defaults to the system wall clock.
 * @returns The current instant as an ISO-8601 string.
 */
export function replicaNowIso(clock: ReplicaClock = systemReplicaClock): string {
  return toReplicaIsoDatetime(clock());
}

/**
 * Remove the remote identity from a replica while preserving its local values.
 *
 * This helper knows only the shared replica identity convention. It does not
 * know or infer any product table columns.
 *
 * @param replica - A replica object containing an `id`.
 * @returns A shallow copy without `id`.
 */
export function withoutReplicaId<T extends { id: unknown }>(replica: T): Omit<T, 'id'> {
  const { id: _id, ...values } = replica;
  return values;
}

/**
 * Attach a remote identity to already-validated local replica values.
 *
 * This helper performs no schema validation; the consuming product remains
 * responsible for its table-derived runtime schema.
 *
 * @param values - Product-owned local values.
 * @param id - Remote identity assigned by the server.
 * @returns A shallow replica object with `id`.
 */
export function withReplicaId<TValues extends object, TId>(values: TValues, id: TId): TValues & { id: TId } {
  return { id, ...values };
}
