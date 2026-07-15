import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateArchive, readArchive } from './archive.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_PATH = path.join(__dirname, '..', 'appointments-archive.csv');

function cleanupArchive() {
  if (fs.existsSync(ARCHIVE_PATH)) fs.unlinkSync(ARCHIVE_PATH);
}

test('appends new aged-out events to the archive', () => {
  cleanupArchive();
  const now = new Date('2026-07-14T12:00:00Z');

  updateArchive(
    [
      {
        id: 'evt-1',
        subject: 'Printer setup, "urgent"',
        start: '2026-07-14T10:00:00Z',
        end: '2026-07-14T11:00:00Z',
        location: 'Room 1',
        person: 'A. Chen',
        categories: ['Completed'],
      },
    ],
    now
  );

  const records = readArchive();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'evt-1');
  assert.equal(records[0].subject, 'Printer setup, "urgent"');
  assert.deepEqual(records[0].categories, ['Completed']);
  cleanupArchive();
});

test('does not duplicate events already archived', () => {
  cleanupArchive();
  const now = new Date('2026-07-14T12:00:00Z');
  const event = {
    id: 'evt-2',
    subject: 'Test',
    start: '2026-07-14T10:00:00Z',
    end: '2026-07-14T11:00:00Z',
    location: '',
    person: '',
    categories: ['Completed'],
  };

  updateArchive([event], now);
  updateArchive([event], now);

  assert.equal(readArchive().length, 1);
  cleanupArchive();
});

test('prunes records older than 30 days', () => {
  cleanupArchive();
  const now = new Date('2026-07-14T12:00:00Z');

  updateArchive(
    [
      {
        id: 'evt-old',
        subject: 'Old event',
        start: '2026-05-01T10:00:00Z',
        end: '2026-05-01T11:00:00Z',
        location: '',
        person: '',
        categories: ['Completed'],
      },
      {
        id: 'evt-recent',
        subject: 'Recent event',
        start: '2026-07-13T10:00:00Z',
        end: '2026-07-13T11:00:00Z',
        location: '',
        person: '',
        categories: ['Completed'],
      },
    ],
    now
  );

  const records = readArchive();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'evt-recent');
  cleanupArchive();
});
