/**
 * Canonical UTC ISO-8601 wire form for an offline replica datetime.
 *
 * @param value - A valid instant represented as a `Date` or parseable string.
 * @returns The instant as an ISO-8601 string.
 * @throws RangeError when the input is not a valid instant.
 */
export function toReplicaIsoDatetime(value: Date | string): string {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Invalid replica datetime: ${String(value)}`);
  }
  return instant.toISOString();
}

/**
 * Canonical `YYYY-MM-DD` wire form for an offline replica date.
 *
 * A date-only string is treated as a calendar value and therefore is not shifted
 * through a timezone. Datetime inputs are converted from their UTC instant.
 *
 * @param value - A date, datetime string, `Date`, or `null`.
 * @returns A canonical date-only string, or `null`.
 * @throws RangeError when the input is not a valid date.
 */
export function toReplicaDateOnly(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new RangeError(`Invalid replica date: ${String(value)}`);
    }
    return value.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const canonicalDate = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(canonicalDate.getTime()) || canonicalDate.toISOString().slice(0, 10) !== value) {
      throw new RangeError(`Invalid replica date: ${value}`);
    }
    return value;
  }
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Invalid replica date: ${value}`);
  }
  return instant.toISOString().slice(0, 10);
}

/**
 * Convert a replica datetime to epoch milliseconds for legacy status DTOs.
 *
 * @param value - A valid instant represented as a `Date` or parseable string.
 * @returns Epoch milliseconds.
 * @throws RangeError when the input is not a valid instant.
 */
export function replicaTimestampMs(value: Date | string): number {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Invalid replica timestamp: ${String(value)}`);
  }
  return instant.getTime();
}

/**
 * Convert a boolean-like value to a MySQL/SQLite tinyint flag.
 *
 * @param value - Boolean or numeric truth value.
 * @returns `1` for truthy values and `0` otherwise.
 */
export function toTinyIntFlag(value: boolean | number): 0 | 1 {
  return value ? 1 : 0;
}

/**
 * Convert a MySQL/SQLite tinyint flag to a boolean.
 *
 * @param value - Numeric flag.
 * @returns `false` only for zero.
 */
export function fromTinyIntFlag(value: number): boolean {
  return value !== 0;
}
