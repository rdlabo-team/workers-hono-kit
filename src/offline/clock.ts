import { toReplicaIsoDatetime } from './wire.js';

/**
 * Read the current wall-clock instant in canonical replica wire form.
 *
 * @param clock - Injectable clock; defaults to the system wall clock.
 * @returns The current instant as an ISO-8601 string.
 */
export function replicaNowIso(clock: () => Date = () => new Date()): string {
  return toReplicaIsoDatetime(clock());
}
