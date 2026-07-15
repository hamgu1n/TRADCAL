// Pure appointment-board logic with no DOM dependencies, so it can be
// unit-tested directly under Node (see logic.test.js) as well as imported
// by app.js in the browser.

// Maps an Outlook category/status string to a badge color class. Matched by
// substring (case-insensitive) so small variations in category naming
// (e.g. "Needs More Work" vs "Incomplete") still map correctly.
export const STATUS_COLOR_RULES = [
  { match: 'computer lab', className: 'status-pink' },
  { match: 'completed', className: 'status-green' },
  { match: 'in progress', className: 'status-yellow' },
  { match: 'incomplete', className: 'status-red' },
  { match: 'needs more work', className: 'status-red' },
  { match: 'scheduled', className: 'status-gray' },
];

export function statusColorClass(status) {
  const normalized = (status ?? '').toLowerCase();
  const rule = STATUS_COLOR_RULES.find((r) => normalized.includes(r.match));
  return rule ? rule.className : 'status-gray';
}

export function isCompletedStatus(status) {
  return (status ?? '').toLowerCase().includes('completed');
}

// No attendee assigned yet falls back to either an empty string or the
// shared mailbox's own organizer identity ("Technician, InfoTech") — both
// mean "nobody's been assigned," so drop it rather than displaying it.
export function isUnassigned(person) {
  const normalized = (person ?? '').trim().toLowerCase();
  return normalized === '' || normalized === 'technician, infotech';
}

// The raw "person" field is multiple attendee names joined with " / "
// (graphClient.js on the server). Each individual name is itself
// "Last, First", so this delimiter must NOT be a comma or splitting back
// into individual names would be ambiguous (e.g. "Lion, Tamara, Meadows,
// David" can't be told apart as one vs. two people — " / " avoids that).
export function parseAttendeeNames(person) {
  return (person ?? '')
    .split('/')
    .map((name) => name.trim())
    .filter(Boolean);
}

// The requester's display name — just the attendee list with the shared
// mailbox's own placeholder identity stripped out. Unlike the technician
// (see getStatusAndTechnician below), this no longer depends on the
// roster: technicians are identified by category now, not by being
// invited, so anyone left in the attendee list is simply "the person."
export function displayPerson(person) {
  const names = parseAttendeeNames(person).filter((name) => !isUnassigned(name));
  return names.length > 0 ? names.join(' / ') : '-';
}

function isRosterMatch(category, technicianRoster) {
  const normalized = (category ?? '').trim().toLowerCase();
  return technicianRoster.some((tech) => tech.trim().toLowerCase() === normalized);
}

// Outlook categories on the event double as both the status (e.g.
// "Completed", "In Progress") and the assigned technician — a technician
// is identified by tagging the event with a category matching their first
// name on the roster (Settings), not by being an attendee. Whichever
// category matches the roster is the technician; the remaining category
// (if any) is the status.
export function getStatusAndTechnician(categories, technicianRoster = []) {
  const list = (Array.isArray(categories) ? categories : []).filter(Boolean);
  const technicianCategory = list.find((c) => isRosterMatch(c, technicianRoster));
  const statusCategory = list.find((c) => c !== technicianCategory);

  return {
    status: statusCategory ?? 'Scheduled',
    technician: technicianCategory ?? '-',
  };
}

export function matchesSearch(event, searchText) {
  const query = (searchText ?? '').trim().toLowerCase();
  if (!query) return true;
  return (
    (event.subject ?? '').toLowerCase().includes(query) ||
    (event.location ?? '').toLowerCase().includes(query)
  );
}

// How far ahead the board shows by default when "Show future appointments"
// is off — the server fetches a much wider window (LOOKAHEAD_MINUTES, often
// days) so past-due/overdue logic and the history archive have real data to
// work with, but the live board itself stays focused on what's actually
// coming up soon unless the viewer asks to see further out.
export const NEAR_TERM_HOURS = 4;

export function filterEvents(
  events,
  {
    now,
    excludedStatuses = new Set(),
    personFilter = 'all',
    technicianFilter = 'all',
    technicianRoster = [],
    showCompleted = false,
    showOverdue = true,
    showFuture = false,
    searchText = '',
  }
) {
  const nearTermCutoff = new Date(now.getTime() + NEAR_TERM_HOURS * 60 * 60 * 1000);

  return events.filter((event) => {
    const start = new Date(event.start);
    const end = new Date(event.end);
    const { status, technician } = getStatusAndTechnician(event.categories, technicianRoster);
    const completed = isCompletedStatus(status);
    const isPastDue = end <= now;

    if (completed && !showCompleted) return false;
    if (isPastDue && !completed && !showOverdue) return false;
    if (!showFuture && start > nearTermCutoff) return false;
    if (excludedStatuses.has(status)) return false;

    const person = displayPerson(event.person);
    if (personFilter !== 'all' && person !== personFilter) return false;
    if (technicianFilter !== 'all' && technician !== technicianFilter) return false;
    if (!matchesSearch(event, searchText)) return false;

    return true;
  });
}

export function sortByStart(events) {
  return [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
}

export function findNextUpcoming(sortedEvents, now) {
  return sortedEvents.find((event) => new Date(event.start) > now);
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
