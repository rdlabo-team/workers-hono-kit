const SNAPSHOT_CURSOR_PREFIX = 'snapshot:v1';

export interface OfflineSnapshotCursor {
  watermark: number;
  sourceIndex: number;
  afterId: number;
}

export function encodeOfflineSnapshotCursor(cursor: OfflineSnapshotCursor): string {
  assertNonNegativeSafeInteger(cursor.watermark, 'watermark');
  assertNonNegativeSafeInteger(cursor.sourceIndex, 'sourceIndex');
  assertNonNegativeSafeInteger(cursor.afterId, 'afterId');
  return `${SNAPSHOT_CURSOR_PREFIX}:${cursor.watermark}:${cursor.sourceIndex}:${cursor.afterId}`;
}

export function decodeOfflineSnapshotCursor(value: string): OfflineSnapshotCursor | null {
  const [snapshot, version, watermarkValue, sourceIndexValue, afterIdValue, extra] = value.split(':');
  if (`${snapshot}:${version}` !== SNAPSHOT_CURSOR_PREFIX || extra !== undefined) {
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
