export const SCHEDULE_TIME_ZONE = "America/Chicago";
export const SCHEDULE_HOUR = 9;
export const SCHEDULE_MINUTE = 17;

export function chicagoDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SCHEDULE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function weeklyScheduleGuard({ now = new Date(), eventName = "workflow_dispatch", scheduledCron = "" } = {}) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIME_ZONE, weekday: "long", hour: "2-digit", hourCycle: "h23", minute: "2-digit", timeZoneName: "shortOffset",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  // GitHub may start cron jobs late. Select by the actual schedule expression
  // and the local UTC offset rather than requiring the runner to start at 09:17.
  const expectedCron = parts.timeZoneName === "GMT-5" ? "17 14 * * 1" : "17 15 * * 1";
  const enabled = eventName !== "schedule" || (parts.weekday === "Monday" && scheduledCron === expectedCron);
  return { enabled, asOf: chicagoDate(now), timeZone: SCHEDULE_TIME_ZONE, expectedCron, reason: enabled ? "ELIGIBLE_SCHEDULE" : "SKIP_OTHER_DST_SCHEDULE" };
}
