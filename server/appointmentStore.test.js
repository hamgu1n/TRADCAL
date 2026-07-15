import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeActiveAlarms } from './appointmentStore.js';

function eventStartingInMinutes(minutes, now) {
  return {
    id: 'evt-1',
    subject: 'Test appointment',
    start: new Date(now.getTime() + minutes * 60_000).toISOString(),
  };
}

test('fires the 30-minute alarm when 30 minutes out', () => {
  const now = new Date();
  const alarms = computeActiveAlarms([eventStartingInMinutes(30, now)], now);
  assert.deepEqual(
    alarms.map((a) => a.thresholdMinutes),
    [30]
  );
});

test('fires the 15-minute alarm when 15 minutes out', () => {
  const now = new Date();
  const alarms = computeActiveAlarms([eventStartingInMinutes(15, now)], now);
  assert.deepEqual(
    alarms.map((a) => a.thresholdMinutes),
    [15]
  );
});

test('fires the 5-minute alarm when 5 minutes out', () => {
  const now = new Date();
  const alarms = computeActiveAlarms([eventStartingInMinutes(5, now)], now);
  assert.deepEqual(
    alarms.map((a) => a.thresholdMinutes),
    [5]
  );
});

test('does not fire any alarm outside the 1-minute windows', () => {
  const now = new Date();
  const alarms = computeActiveAlarms([eventStartingInMinutes(45, now)], now);
  assert.deepEqual(alarms, []);
});

test('does not fire alarms for events that already started', () => {
  const now = new Date();
  const alarms = computeActiveAlarms([eventStartingInMinutes(-5, now)], now);
  assert.deepEqual(alarms, []);
});

test('handles multiple events independently', () => {
  const now = new Date();
  const alarms = computeActiveAlarms(
    [eventStartingInMinutes(30, now), eventStartingInMinutes(5, now), eventStartingInMinutes(60, now)],
    now
  );
  assert.deepEqual(
    alarms.map((a) => a.thresholdMinutes).sort((a, b) => a - b),
    [5, 30]
  );
});
