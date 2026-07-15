import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  statusColorClass,
  isCompletedStatus,
  isUnassigned,
  parseAttendeeNames,
  displayPerson,
  getStatusAndTechnician,
  matchesSearch,
  filterEvents,
  sortByStart,
  findNextUpcoming,
  startOfDay,
} from './logic.js';

test('statusColorClass matches known categories case-insensitively', () => {
  assert.equal(statusColorClass('Completed'), 'status-green');
  assert.equal(statusColorClass('IN PROGRESS'), 'status-yellow');
  assert.equal(statusColorClass('Incomplete'), 'status-red');
  assert.equal(statusColorClass('Needs More Work'), 'status-red');
  assert.equal(statusColorClass('Computer Lab Work'), 'status-pink');
  assert.equal(statusColorClass('Scheduled'), 'status-gray');
  assert.equal(statusColorClass('Something Unrecognized'), 'status-gray');
});

test('isCompletedStatus only matches "completed"', () => {
  assert.equal(isCompletedStatus('Completed'), true);
  assert.equal(isCompletedStatus('Incomplete'), false);
  assert.equal(isCompletedStatus('Scheduled'), false);
});

test('isUnassigned treats blank and the shared-mailbox placeholder as unassigned', () => {
  assert.equal(isUnassigned(''), true);
  assert.equal(isUnassigned('  '), true);
  assert.equal(isUnassigned('Technician, InfoTech'), true);
  assert.equal(isUnassigned('technician, infotech'), true);
  assert.equal(isUnassigned('Davis, Mary'), false);
});

test('parseAttendeeNames splits on " / " (not comma, since names contain commas)', () => {
  assert.deepEqual(parseAttendeeNames('Carr, Matt / Davis, Mary'), ['Carr, Matt', 'Davis, Mary']);
  assert.deepEqual(parseAttendeeNames('Carr, Matt'), ['Carr, Matt']);
  assert.deepEqual(parseAttendeeNames(''), []);
  assert.deepEqual(parseAttendeeNames(null), []);
});

test('displayPerson drops the shared-mailbox placeholder and shows a dash if nothing else', () => {
  assert.equal(displayPerson('Technician, InfoTech'), '-');
  assert.equal(displayPerson(''), '-');
});

test('displayPerson shows remaining attendees once the placeholder is stripped', () => {
  assert.equal(displayPerson('Technician, InfoTech / Flaherty, Carla'), 'Flaherty, Carla');
  assert.equal(displayPerson('Flaherty, Carla / Lion, Tamara'), 'Flaherty, Carla / Lion, Tamara');
});

test('getStatusAndTechnician identifies the technician by roster-matched category, not attendance', () => {
  const roster = ['Matt'];
  const result = getStatusAndTechnician(['Completed', 'Matt'], roster);
  assert.deepEqual(result, { status: 'Completed', technician: 'Matt' });
});

test('getStatusAndTechnician matches roster names case-insensitively', () => {
  const result = getStatusAndTechnician(['Completed', 'matt'], ['Matt']);
  assert.equal(result.technician, 'matt'); // preserves the category's own casing, not the roster's
});

test('getStatusAndTechnician defaults status to "Scheduled" when only a technician category is present', () => {
  const result = getStatusAndTechnician(['Matt'], ['Matt']);
  assert.deepEqual(result, { status: 'Scheduled', technician: 'Matt' });
});

test('getStatusAndTechnician defaults technician to "-" when no category matches the roster', () => {
  const result = getStatusAndTechnician(['Completed'], ['Matt']);
  assert.deepEqual(result, { status: 'Completed', technician: '-' });
});

test('getStatusAndTechnician handles an empty/missing categories list', () => {
  assert.deepEqual(getStatusAndTechnician([], ['Matt']), { status: 'Scheduled', technician: '-' });
  assert.deepEqual(getStatusAndTechnician(undefined, ['Matt']), { status: 'Scheduled', technician: '-' });
});

test('matchesSearch matches subject or location, case-insensitively', () => {
  const event = { subject: 'Printer setup', location: 'Room 204' };
  assert.equal(matchesSearch(event, ''), true);
  assert.equal(matchesSearch(event, 'printer'), true);
  assert.equal(matchesSearch(event, 'ROOM 204'), true);
  assert.equal(matchesSearch(event, 'nope'), false);
});

function makeEvent(overrides = {}) {
  return {
    id: 'evt-1',
    subject: 'Test',
    location: '',
    person: '',
    start: '2026-07-14T10:00:00Z',
    end: '2026-07-14T11:00:00Z',
    categories: ['Scheduled'],
    ...overrides,
  };
}

test('filterEvents hides completed by default', () => {
  const now = new Date('2026-07-14T09:00:00Z');
  const events = [makeEvent({ categories: ['Completed'] }), makeEvent({ id: 'evt-2', categories: ['Scheduled'] })];
  const result = filterEvents(events, { now });
  assert.deepEqual(result.map((e) => e.id), ['evt-2']);
});

test('filterEvents hides past-due incomplete when showOverdue is false', () => {
  const now = new Date('2026-07-14T12:00:00Z'); // after event end
  const events = [makeEvent({ categories: ['Incomplete'] })];
  assert.equal(filterEvents(events, { now, showOverdue: true }).length, 1);
  assert.equal(filterEvents(events, { now, showOverdue: false }).length, 0);
});

test('filterEvents hides events beyond the near-term window unless showFuture is set', () => {
  const now = new Date('2026-07-14T09:00:00Z');
  const events = [
    makeEvent({ id: 'soon', start: '2026-07-14T10:00:00Z', end: '2026-07-14T10:30:00Z' }),
    makeEvent({ id: 'next-week', start: '2026-07-21T10:00:00Z', end: '2026-07-21T10:30:00Z' }),
  ];

  const nearTermOnly = filterEvents(events, { now, showFuture: false });
  assert.deepEqual(nearTermOnly.map((e) => e.id), ['soon']);

  const allFuture = filterEvents(events, { now, showFuture: true });
  assert.deepEqual(
    allFuture.map((e) => e.id).sort(),
    ['next-week', 'soon']
  );
});

test('filterEvents applies status exclusion, person filter, and search together', () => {
  const now = new Date('2026-07-14T09:00:00Z');
  const events = [
    makeEvent({ id: 'a', categories: ['Scheduled'], person: 'Carr, Matt', subject: 'Printer setup' }),
    makeEvent({ id: 'b', categories: ['In Progress'], person: 'Davis, Mary', subject: 'Laptop repair' }),
  ];

  const excludedStatuses = new Set(['In Progress']);
  const result = filterEvents(events, { now, excludedStatuses, personFilter: 'Carr, Matt', searchText: 'printer' });
  assert.deepEqual(result.map((e) => e.id), ['a']);
});

test('filterEvents applies the technician filter against roster-matched categories, not attendees', () => {
  const now = new Date('2026-07-14T09:00:00Z');
  const events = [
    makeEvent({ id: 'a', categories: ['Scheduled', 'Matt'] }),
    makeEvent({ id: 'b', categories: ['Scheduled', 'Mary'] }),
  ];

  const result = filterEvents(events, {
    now,
    technicianFilter: 'Mary',
    technicianRoster: ['Matt', 'Mary'],
  });
  assert.deepEqual(result.map((e) => e.id), ['b']);
});

test('sortByStart orders chronologically without mutating the input', () => {
  const events = [makeEvent({ id: 'later', start: '2026-07-15T10:00:00Z' }), makeEvent({ id: 'earlier', start: '2026-07-14T10:00:00Z' })];
  const sorted = sortByStart(events);
  assert.deepEqual(sorted.map((e) => e.id), ['earlier', 'later']);
  assert.equal(events[0].id, 'later'); // original untouched
});

test('findNextUpcoming returns the first event starting after now', () => {
  const now = new Date('2026-07-14T10:30:00Z');
  const sorted = [
    makeEvent({ id: 'past', start: '2026-07-14T10:00:00Z' }),
    makeEvent({ id: 'next', start: '2026-07-14T11:00:00Z' }),
    makeEvent({ id: 'later', start: '2026-07-14T12:00:00Z' }),
  ];
  assert.equal(findNextUpcoming(sorted, now).id, 'next');
});

test('startOfDay zeroes out the time portion', () => {
  const date = new Date('2026-07-14T15:42:31Z');
  const start = startOfDay(date);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(start.getSeconds(), 0);
});
