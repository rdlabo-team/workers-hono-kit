/**
 * Table-agnostic helpers for offline replica converters.
 *
 * Product table projections, Zod object schemas, allowlists, and domain
 * validation intentionally remain in each consuming Hono application.
 *
 * @packageDocumentation
 */

export { fromTinyIntFlag, replicaTimestampMs, toReplicaDateOnly, toReplicaIsoDatetime, toTinyIntFlag } from './wire.js';
export { replicaNowIso, systemReplicaClock, withoutReplicaId, withReplicaId } from './replica.js';
export type { ReplicaClock } from './replica.js';
export { defineRestDbMethodConverter } from './rest-db-method-converter.js';
export type {
  CompleteDbRow,
  CompleteRestDbTableScheme,
  RestDbMethodConverter,
  RestDbTableScheme,
} from './rest-db-method-converter.js';
