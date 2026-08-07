export function protectCsvFormula(value: string): string {
  const leftTrimmed = value.replace(/^\s+/, "");
  return /^[=+\-@]/.test(leftTrimmed) ? `'${value}` : value;
}

function csvCell(value: string | number): string {
  const protectedValue = typeof value === "string" ? protectCsvFormula(value) : String(value);
  return `"${protectedValue.replace(/"/g, '""')}"`;
}

export function createCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(";"));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function formatCentsForCsv(amountCents: number): string {
  if (!Number.isSafeInteger(amountCents)) throw new Error("CSV_UNSAFE_MONETARY_VALUE");
  const sign = amountCents < 0 ? "-" : "";
  const absolute = Math.abs(amountCents);
  return `${sign}${Math.floor(absolute / 100)},${String(absolute % 100).padStart(2, "0")}`;
}
