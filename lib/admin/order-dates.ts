/**
 * Dates of the admin order screens. The store works in Barnaul, so the date
 * filter treats "from"/"to" as calendar days in Asia/Barnaul (UTC+7 now, UTC+6
 * in 2014-2016; the tz database of Intl handles both), and times are shown in
 * the same zone on the server and in the browser (no hydration mismatch).
 */

export const STORE_TIME_ZONE = "Asia/Barnaul";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINIMUM_YEAR = 2000;
const MAXIMUM_YEAR = 2100;

/** True for a real calendar date "YYYY-MM-DD" between 2000 and 2100. */
export function isCalendarDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < MINIMUM_YEAR || year > MAXIMUM_YEAR) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (east is positive). */
function timeZoneOffsetMilliseconds(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? Number.NaN);
  const wallClockAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wallClockAsUtc - (instant - (((instant % 1000) + 1000) % 1000));
}

/**
 * First instant of the calendar day `isoDate` ("YYYY-MM-DD") in `timeZone`,
 * as a UTC Date. Throws on a value that is not a calendar date.
 */
export function zonedDayStart(isoDate: string, timeZone = STORE_TIME_ZONE): Date {
  if (!isCalendarDate(isoDate)) throw new RangeError("INVALID_CALENDAR_DATE");
  const [year, month, day] = isoDate.split("-").map(Number);
  const wallClockMidnight = Date.UTC(year, month - 1, day);
  const firstGuess = wallClockMidnight - timeZoneOffsetMilliseconds(wallClockMidnight, timeZone);
  // The offset at the guessed instant can differ when a DST/offset change is near.
  return new Date(wallClockMidnight - timeZoneOffsetMilliseconds(firstGuess, timeZone));
}

/** "YYYY-MM-DD" of the next calendar day. */
export function nextCalendarDate(isoDate: string): string {
  if (!isCalendarDate(isoDate)) throw new RangeError("INVALID_CALENDAR_DATE");
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Half-open UTC range [start, end) of the store-time days from..to
 * (both inclusive). Either side may be missing.
 */
export function storeDateRange(
  from?: string,
  to?: string,
  timeZone = STORE_TIME_ZONE,
): { start?: Date; end?: Date } {
  return {
    start: from ? zonedDayStart(from, timeZone) : undefined,
    end: to ? zonedDayStart(nextCalendarDate(to), timeZone) : undefined,
  };
}

const dateTimeFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: STORE_TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "11.10.2026, 14:05" in store time; "—" for a missing or invalid value. */
export function formatStoreDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTimeFormatter.format(date);
}
