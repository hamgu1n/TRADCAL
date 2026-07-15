import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROSTER_PATH = path.join(__dirname, '..', 'technicians.csv');

// Persisted server-side as a plain CSV (rather than only in the browser's
// localStorage or a JSON blob) so the roster survives a browser reset, is
// the same regardless of which device someone edits Settings from, AND can
// be hand-edited directly (e.g. in Excel) — add or remove a row and it
// takes effect on the next poll, same as editing via Settings.
//
// Names are always quoted because the "Last, First" format itself contains
// a comma — a bare CSV field with a comma in it would be misread as two
// columns.
function csvEscape(value) {
  const str = String(value ?? '');
  return `"${str.replace(/"/g, '""')}"`;
}

function csvUnescapeLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

export function readRoster() {
  if (!fs.existsSync(ROSTER_PATH)) return [];
  const content = fs.readFileSync(ROSTER_PATH, 'utf8').trim();
  if (!content) return [];

  const [, ...rows] = content.split('\n'); // skip header row
  return rows.filter(Boolean).map(csvUnescapeLine);
}

export function writeRoster(names) {
  const deduped = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const lines = ['name', ...deduped.map(csvEscape)];
  fs.writeFileSync(ROSTER_PATH, lines.join('\n') + '\n', 'utf8');
  return deduped;
}
