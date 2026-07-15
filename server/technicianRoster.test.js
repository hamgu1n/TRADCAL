import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRoster, writeRoster } from './technicianRoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROSTER_PATH = path.join(__dirname, '..', 'technicians.csv');

function cleanup() {
  if (fs.existsSync(ROSTER_PATH)) fs.unlinkSync(ROSTER_PATH);
}

test('readRoster returns an empty array when no file exists', () => {
  cleanup();
  assert.deepEqual(readRoster(), []);
});

test('writeRoster persists names and readRoster reads them back', () => {
  cleanup();
  writeRoster(['Carr, Matt', 'Davis, Mary']);
  assert.deepEqual(readRoster(), ['Carr, Matt', 'Davis, Mary']);
  cleanup();
});

test('writeRoster dedupes and trims whitespace', () => {
  cleanup();
  writeRoster([' Carr, Matt ', 'Carr, Matt', 'Davis, Mary', '']);
  assert.deepEqual(readRoster(), ['Carr, Matt', 'Davis, Mary']);
  cleanup();
});

test('names are quoted since "Last, First" contains a comma, and survive a round trip', () => {
  cleanup();
  writeRoster(['Hlioui, Haytham']);
  const raw = fs.readFileSync(ROSTER_PATH, 'utf8');
  assert.match(raw, /^"Hlioui, Haytham"$/m);
  assert.deepEqual(readRoster(), ['Hlioui, Haytham']);
  cleanup();
});

test('readRoster reads back a file hand-edited outside the app', () => {
  cleanup();
  fs.writeFileSync(ROSTER_PATH, 'name\n"Carr, Matt"\n"Davis, Mary"\n', 'utf8');
  assert.deepEqual(readRoster(), ['Carr, Matt', 'Davis, Mary']);
  cleanup();
});
