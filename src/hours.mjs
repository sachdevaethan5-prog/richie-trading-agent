// Market hours, shared by live Richie and the dashboard (which must not load runner.mjs and its broker code).
// NYSE full holidays and 1 pm early closes (the exchange's published calendar). Extend each year.
export const HOLIDAYS = new Set(["2026-11-26", "2026-12-25", "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04", "2028-11-23", "2028-12-25"]);   // 2028-01-01 is a Saturday: no holiday
export const EARLY_CLOSE = new Set(["2026-11-27", "2026-12-24", "2027-11-26", "2028-07-03", "2028-11-24"]);
// US regular session, Eastern: weekdays 9:30 to 16:00 (13:00 on early-close days), closed on holidays.
export function marketOpen(ms) {
  const e = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" })
    .formatToParts(ms).map(p => [p.type, p.value]));
  const m = Number(e.hour) * 60 + Number(e.minute), day = `${e.year}-${e.month}-${e.day}`;
  return !["Sat", "Sun"].includes(e.weekday) && !HOLIDAYS.has(day) && m >= 9 * 60 + 30 && m < (EARLY_CLOSE.has(day) ? 13 : 16) * 60;
}
