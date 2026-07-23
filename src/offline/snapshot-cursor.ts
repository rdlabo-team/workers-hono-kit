const SNAPSHOT_CURSOR_PREFIX = 'snapshot:v1';
const CANONICAL_NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/;

/** Position of a keyset-paginated initial snapshot at a captured journal watermark. */
export interface OfflineSnapshotCursor {
  /** Highest journal revision captured before the snapshot scan starts. */
  watermark: number;
  /** Zero-based product-defined snapshot source index. */
  sourceIndex: number;
  /** Last server-side numeric ID emitted from the current source. */
  afterId: number;
}

/** Encodes an initial-snapshot position as a stable versioned cursor. */
export function encodeOfflineSnapshotCursor(cursor: OfflineSnapshotCursor): string {
  assertNonNegativeSafeInteger(cursor.watermark, 'watermark');
  assertNonNegativeSafeInteger(cursor.sourceIndex, 'sourceIndex');
  assertNonNegativeSafeInteger(cursor.afterId, 'afterId');
  return `${SNAPSHOT_CURSOR_PREFIX}:${cursor.watermark}:${cursor.sourceIndex}:${cursor.afterId}`;
}

/** Decodes a versioned initial-snapshot cursor, returning null for malformed input. */
export function decodeOfflineSnapshotCursor(value: string): OfflineSnapshotCursor | null {
  const parts = value.split(':');
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== SNAPSHOT_CURSOR_PREFIX) {
    return null;
  }
  const [, , watermarkValue, sourceIndexValue, afterIdValue] = parts;
  if (
    !CANONICAL_NON_NEGATIVE_INTEGER.test(watermarkValue) ||
    !CANONICAL_NON_NEGATIVE_INTEGER.test(sourceIndexValue) ||
    !CANONICAL_NON_NEGATIVE_INTEGER.test(afterIdValue)
  ) {
    return null;
  }
  const watermark = Number(watermarkValue);
  const sourceIndex = Number(sourceIndexValue);
  const afterId = Number(afterIdValue);
  if (
    !isNonNegativeSafeInteger(watermark) ||
    !isNonNegativeSafeInteger(sourceIndex) ||
    !isNonNegativeSafeInteger(afterId)
  ) {
    return null;
  }
  return { watermark, sourceIndex, afterId };
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertNonNegativeSafeInteger(value: number, field: keyof OfflineSnapshotCursor): void {
  if (!isNonNegativeSafeInteger(value)) {
    throw new RangeError(`Offline snapshot cursor ${field} must be a non-negative safe integer.`);
  }
}
