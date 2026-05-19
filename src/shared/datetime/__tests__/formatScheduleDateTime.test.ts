import { formatScheduleDateTime } from '../formatScheduleDateTime';

describe('formatScheduleDateTime', () => {
  const NOW = new Date(2026, 4, 19, 10, 30); // May 19, 2026 10:30 local

  it('renders "Today at h:mm AM/PM" for same-day datetimes', () => {
    const todayAt345pm = new Date(2026, 4, 19, 15, 45);
    expect(formatScheduleDateTime(todayAt345pm, NOW)).toBe('Today at 3:45 PM');
  });

  it('renders "Tomorrow at h:mm AM/PM" for next-day datetimes', () => {
    const tomorrowAt900am = new Date(2026, 4, 20, 9, 0);
    expect(formatScheduleDateTime(tomorrowAt900am, NOW)).toBe(
      'Tomorrow at 9:00 AM',
    );
  });

  it('renders "Day, Mon dd, yyyy at h:mm AM/PM" for any other date', () => {
    const friday = new Date(2026, 4, 22, 19, 30);
    expect(formatScheduleDateTime(friday, NOW)).toBe(
      'Fri, May 22, 2026 at 7:30 PM',
    );
  });

  it('pads minutes < 10', () => {
    const at903am = new Date(2026, 4, 19, 9, 3);
    expect(formatScheduleDateTime(at903am, NOW)).toBe('Today at 9:03 AM');
  });

  it('renders 12 (not 0) for midnight and noon', () => {
    const midnight = new Date(2026, 4, 19, 0, 0);
    expect(formatScheduleDateTime(midnight, NOW)).toBe('Today at 12:00 AM');
    const noon = new Date(2026, 4, 19, 12, 0);
    expect(formatScheduleDateTime(noon, NOW)).toBe('Today at 12:00 PM');
  });
});
