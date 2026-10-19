import { fetchUpcomingEvents, fetchEventsInRange } from './graphClient.js';
import { generateMockEvents } from './mockData.js';
import { updateArchive } from './archive.js';

const ALARM_THRESHOLDS_MINUTES = [30, 15, 5];
const ARCHIVE_BACKFILL_DAYS = 30;

let cachedEvents = [];

// Per-event record of which alarms (indexed like ALARM_THRESHOLDS_MINUTES:
// [30, 15, 5]) a display has already played a sound for. Kept server-side so
// it survives the kiosk's periodic page reload — otherwise a reload inside an
// alarm's one-minute window replays the same alarm. Keyed by event id, with
// the start time it was recorded against: if the appointment is rescheduled,
// its flags reset so the alarms fire again for the new time.
const playedAlarms = new Map();

function emptyPlayedFlags() {
  return ALARM_THRESHOLDS_MINUTES.map(() => false);
}

function playedFlagsFor(event) {
  const entry = playedAlarms.get(event.id);
  return entry && entry.start === event.start ? entry.flags : emptyPlayedFlags();
}

export function getCachedEvents() {
  return cachedEvents.map((event) => ({ ...event, played: [...playedFlagsFor(event)] }));
}

// Returns false if the event or threshold is unknown, so the endpoint can
// reject it rather than silently storing junk.
export function markAlarmPlayed(eventId, thresholdMinutes) {
  const index = ALARM_THRESHOLDS_MINUTES.indexOf(thresholdMinutes);
  const event = cachedEvents.find((e) => e.id === eventId);
  if (index === -1 || !event) return false;

  const flags = playedFlagsFor(event);
  flags[index] = true;
  playedAlarms.set(event.id, { start: event.start, flags });
  return true;
}

// An event tagged with the "Tech Out" category (technician unavailable)
// isn't a real bookable appointment — excluded from the board, alarms, and
// the archive entirely, the same way all-day OOO events already are.
function isTechOut(event) {
  return (event.categories ?? []).some((c) => c.trim().toLowerCase() === 'tech out');
}

// The archive only fills in going forward, one appointment at a time, as
// each one ages past the live query window — so on a fresh install (or
// right after this feature shipped) it starts out empty and would otherwise
// take weeks to reflect a full month of history. This backfills it once at
// startup by pulling the last 30 days directly from Graph.
export async function backfillArchive(now = new Date()) {
  if (process.env.USE_MOCK_DATA === 'true') return;

  const start = new Date(now.getTime() - ARCHIVE_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
  const events = await fetchEventsInRange(start, now);
  updateArchive(events.filter((e) => !isTechOut(e)), now);
}

export async function refreshEvents() {
  const now = new Date();
  let freshEvents;

  if (process.env.USE_MOCK_DATA === 'true') {
    freshEvents = generateMockEvents(now);
  } else {
    const lookaheadMinutes = Number(process.env.LOOKAHEAD_MINUTES ?? 180);
    const lookbackMinutes = Number(process.env.LOOKBACK_MINUTES ?? 1440);
    freshEvents = await fetchUpcomingEvents(lookaheadMinutes, lookbackMinutes);
  }

  freshEvents = freshEvents.filter((e) => !isTechOut(e));

  // Anything that was on the board last poll but has since aged out of the
  // Graph query window (and has actually ended, not just been rescheduled)
  // gets archived to CSV instead of silently disappearing, so a month of
  // appointment history is kept even though the live board only shows
  // recent/upcoming appointments.
  const freshIds = new Set(freshEvents.map((event) => event.id));
  const agedOut = cachedEvents.filter(
    (event) => !freshIds.has(event.id) && new Date(event.end) <= now
  );
  updateArchive(agedOut, now);

  return replaceCachedEvents(freshEvents);
}

// Played flags for the Settings → "Test played flags" buttons: a stand-in
// appointment that isn't on the calendar, so the skip-if-played behavior can
// be checked (including across a page reload) without waiting for a real
// appointment to hit 30/15/5 minutes out.
let testAlarmPlayed = emptyPlayedFlags();

export function getTestAlarmPlayed() {
  return [...testAlarmPlayed];
}

export function markTestAlarmPlayed(thresholdMinutes) {
  const index = ALARM_THRESHOLDS_MINUTES.indexOf(thresholdMinutes);
  if (index === -1) return false;
  testAlarmPlayed[index] = true;
  return true;
}

export function resetTestAlarmPlayed() {
  testAlarmPlayed = emptyPlayedFlags();
}

// Swaps in a fresh event list, dropping played-alarm flags for events that
// are no longer on it. Split out from refreshEvents() so it's testable
// without Graph or touching the archive file.
export function replaceCachedEvents(freshEvents) {
  const freshIds = new Set(freshEvents.map((event) => event.id));
  for (const id of playedAlarms.keys()) {
    if (!freshIds.has(id)) playedAlarms.delete(id);
  }

  cachedEvents = freshEvents;
  return cachedEvents;
}

// For each event, figure out which alarm thresholds it currently falls in
// (the minute window during which that threshold should be firing).
export function computeActiveAlarms(events, now = new Date()) {
  const alarms = [];

  for (const event of events) {
    const minutesUntilStart = (new Date(event.start) - now) / 60_000;

    for (const threshold of ALARM_THRESHOLDS_MINUTES) {
      // Fires for the one-minute window starting at the threshold,
      // e.g. the 15-min alarm is active from 15:00 to 14:00 minutes out.
      if (minutesUntilStart <= threshold && minutesUntilStart > threshold - 1) {
        alarms.push({
          eventId: event.id,
          subject: event.subject,
          thresholdMinutes: threshold,
        });
      }
    }
  }

  return alarms;
}
