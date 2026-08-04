export function formatDateInputInTimeZone(date: Date, timeZone: string): string {
  if (Number.isNaN(date.getTime())) throw new Error("Date invalide");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  if (!year || !month || !day) throw new Error("Date impossible à formater");
  return `${year}-${month}-${day}`;
}

export function getTodayInParis(date = new Date()): string {
  return formatDateInputInTimeZone(date, "Europe/Paris");
}
