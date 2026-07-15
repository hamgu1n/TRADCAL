import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_PATH = path.join(__dirname, '..', 'appointments-archive.csv');
const RETENTION_DAYS = 30;
const COLUMNS = ['id', 'subject', 'start', 'end', 'location', 'person', 'categories'];

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Minimal RFC4180-style parser for one line — sufficient here since fields
// are escaped on write and never contain raw newlines.
function csvSplitLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

export function readArchive() {
  if (!fs.existsSync(ARCHIVE_PATH)) return [];
  const content = fs.readFileSync(ARCHIVE_PATH, 'utf8').trim();
  if (!content) return [];

  const [, ...rows] = content.split('\n');
  return rows
    .filter(Boolean)
    .map((line) => {
      const values = csvSplitLine(line);
      const record = {};
      COLUMNS.forEach((col, idx) => (record[col] = values[idx] ?? ''));
      // Categories is a list (status + technician are both categories on
      // the same event), stored as JSON inside the CSV cell.
      try {
        record.categories = JSON.parse(record.categories || '[]');
      } catch {
        record.categories = [];
      }
      return record;
    });
}

function writeArchive(records) {
  const header = COLUMNS.join(',');
  const rows = records.map((r) =>
    COLUMNS.map((col) => csvEscape(col === 'categories' ? JSON.stringify(r[col] ?? []) : r[col])).join(',')
  );
  fs.writeFileSync(ARCHIVE_PATH, [header, ...rows].join('\n') + '\n', 'utf8');
}

// Appends appointments that have aged out of the live Graph query window
// (skipping ones already recorded) and prunes anything older than the
// retention window, so the archive holds a rolling ~30 days of history
// even though the kiosk board itself only shows recent/upcoming events.
export function updateArchive(agedOutEvents, now = new Date()) {
  const existing = readArchive();
  const existingIds = new Set(existing.map((r) => r.id));

  const newRecords = agedOutEvents
    .filter((event) => !existingIds.has(event.id))
    .map((event) => ({
      id: event.id,
      subject: event.subject,
      start: event.start,
      end: event.end,
      location: event.location,
      person: event.person,
      categories: event.categories ?? [],
    }));

  const retentionCutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const kept = [...existing, ...newRecords].filter((r) => new Date(r.end) >= retentionCutoff);

  writeArchive(kept);
  return kept;
}
