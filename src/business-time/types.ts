/** JST 業務暦日 `YYYY-MM-DD`（instant ではない）。 */
export type BusinessDate = string;

/** JST 業務日時 `YYYY-MM-DD HH:mm:ss`（MySQL DATETIME 互換の壁時計表現）。 */
export type BusinessDateTime = string;

/** JST 業務タイムゾーン定数（Workers は UTC instant、業務はここで明示）。 */
export const BUSINESS_TIMEZONE = {
  iana: 'Asia/Tokyo',
  offsetMinutes: 540,
} as const;
