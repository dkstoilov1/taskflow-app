/** Calendar-only arithmetic; deadlines are never interpreted as UTC instants. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day + days);
  date.setHours(12, 0, 0, 0);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dateInZone(timeZone: string, instant = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function weekStartFor(today: string): string {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  return shiftDate(today, -((date.getDay() + 6) % 7));
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
