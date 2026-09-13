export function normalizeSpreadsheetRows(rows) {
  if (!Array.isArray(rows)) return [];

  return rows
    .filter(Array.isArray)
    .map((row) => Array.from(row, (cell) => String(cell ?? "")))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
}
