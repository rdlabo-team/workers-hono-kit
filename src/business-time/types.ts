/** A JST business calendar date `YYYY-MM-DD` (a calendar day, not an instant). */
export type BusinessDate = string;

/** A JST business date-time `YYYY-MM-DD HH:mm:ss` (a wall-clock value, MySQL `DATETIME`-compatible). */
export type BusinessDateTime = string;

/** JST business timezone constant. Workers run in UTC instants; business time is made explicit here. */
export const BUSINESS_TIMEZONE = {
  iana: 'Asia/Tokyo',
  offsetMinutes: 540,
} as const;
