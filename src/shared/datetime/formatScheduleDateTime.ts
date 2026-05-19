/**
 * Format a scheduled pickup datetime for display.
 *
 * Matches the legacy yeride `utils/DatetimeUtil.formatDateTime` shape
 * 1:1, but implemented against `Intl.DateTimeFormat` (built-in to
 * Hermes) instead of `date-fns`. The rewrite doesn't carry date-fns.
 *
 * Output examples (`now` = 2026-05-19 10:30):
 *   - `date` = today 15:45            → "Today at 3:45 PM"
 *   - `date` = tomorrow 09:00         → "Tomorrow at 9:00 AM"
 *   - `date` = next Friday 19:30      → "Fri, May 22, 2026 at 7:30 PM"
 *
 * The `now` parameter is injectable so tests can pin the relative
 * "Today / Tomorrow" comparison without monkey-patching `Date`.
 *
 * Time-zone behavior matches the legacy app: every date is rendered
 * in the device's local zone (the Cloud Function then re-projects to
 * America/New_York server-side; the rider sees the wall-clock pickup
 * in their device zone, which is what they picked).
 */
export function formatScheduleDateTime(
  date: Date,
  now: Date = new Date(),
): string {
  const time = formatTime(date);
  if (isSameDay(date, now)) {
    return `Today at ${time}`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(date, tomorrow)) {
    return `Tomorrow at ${time}`;
  }
  const dayName = date.toLocaleString(undefined, { weekday: 'short' });
  const datePart = date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${dayName}, ${datePart} at ${time}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(date: Date): string {
  // Avoid `Intl.DateTimeFormat`'s `hour: 'numeric'` localized variants
  // (the iOS Hermes engine returns the wrong locale token under some
  // setups). Building the "h:mm AM/PM" string manually keeps the output
  // stable and matches the legacy date-fns `'h:mm a'` shape.
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const minutePadded = minutes < 10 ? `0${minutes}` : String(minutes);
  return `${hour12}:${minutePadded} ${ampm}`;
}
