// Dates in India time (board task CMT-27, PRD rule 7.8).
//
// All "per day" numbers (clicks per day, unique clicks, the 50-links-a-day
// limit) use the Indian day, not the server's day. Vercel servers run in UTC,
// so a click at 1:00 AM in India would otherwise land on the previous day.

// India is UTC+5:30 all year (no daylight saving), so a fixed offset is enough.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

// "YYYY-MM-DD" of the Indian day for a moment in time.
// istDay(new Date("2026-11-11T18:30:00Z")) → "2026-11-12" (it is midnight in India).
export function istDay(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// Seconds from `date` until the next Indian midnight. Used to make a
// "per day" Redis key expire exactly when the Indian day ends.
export function secondsUntilIstMidnight(date = new Date()) {
  const msIntoIstDay = (date.getTime() + IST_OFFSET_MS) % (24 * 60 * 60 * 1000);
  return Math.ceil((24 * 60 * 60 * 1000 - msIntoIstDay) / 1000);
}
