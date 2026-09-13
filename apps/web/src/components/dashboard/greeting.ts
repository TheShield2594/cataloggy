// The two clock-derived strings in the dashboard header, and when they change.

export function timeOfDayGreeting(now: Date) {
  const hour = now.getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

// The hours at which the header's two clock-derived strings change: the
// greeting cutoffs above, plus midnight, which also rolls the date over.
export const GREETING_CUTOFF_HOURS = [0, 5, 12, 18];

// Whether two instants would render the header identically — the greeting and
// the date together, which is more than the day-boundary default the hook uses
// for pages that only ask what day it is.
export const showsSameHeader = (a: Date, b: Date) =>
  timeOfDayGreeting(a) === timeOfDayGreeting(b) && a.toDateString() === b.toDateString();
