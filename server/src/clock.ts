// Local calendar date as YYYY-MM-DD. UTC would make a claim dated "today" look
// like it is in the future for part of the day in India.
export function localToday(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Shifts a YYYY-MM-DD date by whole days (used by the seed data).
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`); // noon avoids DST edge cases
  d.setDate(d.getDate() + days);
  return localToday(d);
}
