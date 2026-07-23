/**
 * Table-agnostic helpers for offline replica converters.
 *
 * Product table projections, Zod object schemas, allowlists, and domain
 * validation intentionally remain in each consuming Hono application.
 *
 * @packageDocumentation
 */

export { fromTinyIntFlag, replicaTimestampMs, toReplicaDateOnly, toReplicaIsoDatetime, toTinyIntFlag } from './wire.js';
export { replicaNowIso } from './clock.js';
export { defineRestDbMethodConverter } from './rest-db-method-converter.js';
export type { RestDbMethodConverter } from './rest-db-method-converter.js';
