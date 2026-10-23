// CSV writing that is safe to open in a spreadsheet.
//
// Beyond RFC 4180 quoting, cells that START with = + - @ (or a tab / carriage return) are prefixed
// with an apostrophe, because Excel/Sheets would otherwise evaluate them as formulas
// ("CSV injection": a ticket subject like =HYPERLINK(...) must not run on an admin's machine).
export const BOM = '﻿'; // lets Excel detect UTF-8

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells) => `${cells.map(csvCell).join(',')}\r\n`;
