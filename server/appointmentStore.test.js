import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeActiveAlarms,
  replaceCachedEvents,
  getCachedEvents,
  markAlarmPlayed,
  getTestAlarmPlayed,
  markTestAlarmPlayed,
  resetTestAlarmPlayed,
} from './appointmentStore.js';

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

// The store is module-level state, so clear it first to keep flags from one
// test leaking into the next.
function resetStore(events) {
  replaceCachedEvents([]);
  replaceCachedEvents(events);
}

function playedFlags(eventId) {
  return getCachedEvents().find((e) => e.id === eventId).played;
}

test('events start with no alarms played', () => {
  resetStore([{ id: 'evt-1', start: '2026-10-19T15:00:00Z' }]);
  assert.deepEqual(playedFlags('evt-1'), [false, false, false]);
});

test('marking an alarm played sets the flag for that threshold only', () => {
  resetStore([{ id: 'evt-1', start: '2026-10-19T15:00:00Z' }]);
  assert.equal(markAlarmPlayed('evt-1', 15), true);
  assert.deepEqual(playedFlags('evt-1'), [false, true, false]);
  markAlarmPlayed('evt-1', 5);
  assert.deepEqual(playedFlags('evt-1'), [false, true, true]);
});

test('played flags survive a re-poll that returns the same event', () => {
  resetStore([{ id: 'evt-1', start: '2026-10-19T15:00:00Z' }]);
  markAlarmPlayed('evt-1', 30);
  replaceCachedEvents([{ id: 'evt-1', start: '2026-10-19T15:00:00Z' }]);
  assert.deepEqual(playedFlags('evt-1'), [true, false, false]);
});

test('rescheduling an event resets its played flags', () => {
  resetStore([{ id: 'evt-1', start: '2026-10-19T15:00:00Z' }]);
  markAlarmPlayed('evt-1', 30);
  replaceCachedEvents([{ id: 'evt-1', start: '2026-10-19T16:00:00Z' }]);
  assert.deepEqual(playedFlags('evt-1'), [false, false, false]);
});

test('played flags are dropped once an event leaves the list', () => {
  resetStore([{ id: 'evt-1', start: '2026-10-19T15:00:00Z' }]);
  markAlarmPlayed('evt-1', 30);
  replaceCachedEvents([]);
  replaceCachedEvents([{ id: 'evt-1', start: '2026-10-19T15:00:00Z' }]);
  assert.deepEqual(playedFlags('evt-1'), [false, false, false]);
});

test('rejects unknown events and thresholds', () => {
  resetStore([{ id: 'evt-1', start: '2026-10-19T15:00:00Z' }]);
  assert.equal(markAlarmPlayed('nope', 30), false);
  assert.equal(markAlarmPlayed('evt-1', 10), false);
  assert.deepEqual(playedFlags('evt-1'), [false, false, false]);
});

test('test alarm played flags set, survive polls, and reset', () => {
  resetTestAlarmPlayed();
  assert.equal(markTestAlarmPlayed(15), true);
  replaceCachedEvents([]);
  assert.deepEqual(getTestAlarmPlayed(), [false, true, false]);
  assert.equal(markTestAlarmPlayed(10), false);
  resetTestAlarmPlayed();
  assert.deepEqual(getTestAlarmPlayed(), [false, false, false]);
});
