export function getUtcWeekStart(input = new Date()): string {
  const date = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

export function getUtcDayStart(input = new Date()): string {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

export function getUtcMonthStart(input = new Date()): string {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

export function formatHumanDate(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}
