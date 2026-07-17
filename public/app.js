import {
  statusColorClass,
  isCompletedStatus,
  displayPerson,
  getStatusAndTechnician,
  filterEvents,
  sortByStart,
  findNextUpcoming,
  startOfDay,
} from './logic.js';

const clockEl = document.getElementById('clock');
const lastUpdatedEl = document.getElementById('last-updated');
const bannerEl = document.getElementById('alarm-banner');
const alarmBannerTitleEl = document.getElementById('alarm-banner-title');
const alarmBannerDetailsEl = document.getElementById('alarm-banner-details');
const alarmDismissEl = document.getElementById('alarm-dismiss');
const staleBannerEl = document.getElementById('stale-banner');
const actionErrorBannerEl = document.getElementById('action-error-banner');
const mockBadgeEl = document.getElementById('mock-badge');
const filterBadgeEl = document.getElementById('filter-badge');
const muteBadgeEl = document.getElementById('mute-badge');
const bodyEl = document.getElementById('appointments-body');
const emptyStateEl = document.getElementById('empty-state');
const alarmSound = document.getElementById('alarm-sound');
const pingSound = document.getElementById('ping-sound');
const statusDropdownEl = document.getElementById('status-dropdown');
const statusDropdownToggleEl = document.getElementById('status-dropdown-toggle');
const statusDropdownPanelEl = document.getElementById('status-dropdown-panel');
const personFilterEl = document.getElementById('person-filter');
const searchInputEl = document.getElementById('search-input');
const showCompletedEl = document.getElementById('show-completed');
const showOverdueEl = document.getElementById('show-overdue');
const showDateEl = document.getElementById('show-date');
const showFutureEl = document.getElementById('show-future');
const themeToggleEl = document.getElementById('theme-toggle');
const appointmentsTableEl = document.getElementById('appointments');
const settingsToggleEl = document.getElementById('settings-toggle');
const settingsOverlayEl = document.getElementById('settings-overlay');
const settingsCloseEl = document.getElementById('settings-close');
const refreshNowEl = document.getElementById('refresh-now');
const resetFiltersEl = document.getElementById('reset-filters');
const testAlarmEl = document.getElementById('test-alarm');
const testPingEl = document.getElementById('test-ping');
const testNewAppointmentEl = document.getElementById('test-new-appointment');
const openHistoryEl = document.getElementById('open-history');
const historyOverlayEl = document.getElementById('history-overlay');
const historyCloseEl = document.getElementById('history-close');
const historyBodyEl = document.getElementById('history-body');
const technicianFilterEl = document.getElementById('technician-filter');
const technicianEmailInputEl = document.getElementById('technician-email-input');
const technicianAddBtnEl = document.getElementById('technician-add-btn');
const technicianListEl = document.getElementById('technician-list');

let currentAlarmKey = null;
let dismissedAlarmKey = null;
let testAlarmActive = false;
// The set of event IDs currently passing the active filters (search, status,
// person/technician, show-completed/overdue/future) — kept in sync every
// time the table re-renders, so alarms only fire for appointments actually
// visible on the board right now, not ones hidden by a filter.
let displayedEventIds = new Set();
// Technician roster (managed in Settings, persisted server-side). Declared
// here rather than down near the roster UI code so it's already defined by
// the time earlier-in-file code (e.g. the show-future toggle init) calls
// renderEvents(), which reads it.
let technicians = [];
let latestSnapshot = {
  events: [],
  alarms: [],
  lastUpdated: null,
  mockMode: false,
  pollIntervalSeconds: 60,
  consecutiveFailures: 0,
  lastError: null,
};

// Statuses the user has unchecked in the status filter dropdown. A status
// not in this set is considered "shown" — so newly-seen statuses default to
// visible without the user having to opt in each one individually. Restored
// from localStorage so a filter choice survives a page refresh (this board
// runs unattended and reloads itself every few minutes — see
// AUTO_RELOAD_INTERVAL_MS below).
const excludedStatuses = new Set(JSON.parse(localStorage.getItem('tradcal-excluded-statuses') ?? '[]'));

// Statuses the user has muted via the 🔔 toggle next to each status in the
// same dropdown — independent of visibility above: a status can still be
// shown on the board while its alarms/pings are silenced (e.g. "In
// Progress" appointments someone doesn't want re-pinged about). Checked in
// eligibleAlarms() and checkForNewAppointments() further down.
const notificationDisabledStatuses = new Set(
  JSON.parse(localStorage.getItem('tradcal-notification-disabled-statuses') ?? '[]')
);

// --- Theme ---

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggleEl.textContent = theme === 'light' ? '🌙 Dark mode' : '☀️ Light mode';
  localStorage.setItem('tradcal-theme', theme);
}

applyTheme(localStorage.getItem('tradcal-theme') === 'light' ? 'light' : 'dark');

themeToggleEl.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
});

// --- Screen Wake Lock: this runs unattended on a shared monitor, so the
// display should never fall asleep or let a screensaver take over. ---

let wakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // Some browsers/contexts refuse (e.g. tab not visible, battery saver);
    // the kiosk just behaves as it did before this feature existed.
  }
}

requestWakeLock();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

// --- Status filter dropdown ---

function updateStatusDropdownToggleLabel(totalStatuses) {
  const hiddenCount = excludedStatuses.size;
  statusDropdownToggleEl.textContent =
    hiddenCount === 0 ? 'Status: All ▾' : `Status: ${totalStatuses - hiddenCount}/${totalStatuses} ▾`;
}

function populateStatusDropdown(statuses) {
  // Drop exclusions for statuses that no longer appear in the data, so a
  // status that comes back later starts out visible again. Skipped while
  // `statuses` is empty — renderEvents() runs once with no events at all
  // before the first real SSE snapshot arrives, and treating that as "none
  // of these statuses exist anymore" would wipe out exclusions restored
  // from localStorage before real data ever had a chance to load.
  if (statuses.length > 0) {
    for (const excluded of [...excludedStatuses]) {
      if (!statuses.includes(excluded)) excludedStatuses.delete(excluded);
    }
    for (const muted of [...notificationDisabledStatuses]) {
      if (!statuses.includes(muted)) notificationDisabledStatuses.delete(muted);
    }
  }

  statusDropdownPanelEl.innerHTML = '';
  for (const status of statuses) {
    const row = document.createElement('div');
    row.className = 'dropdown-option status-option';

    const label = document.createElement('label');
    label.className = 'status-option-label';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !excludedStatuses.has(status);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) excludedStatuses.delete(status);
      else excludedStatuses.add(status);
      localStorage.setItem('tradcal-excluded-statuses', JSON.stringify([...excludedStatuses]));
      renderEvents(latestSnapshot.events);
    });

    label.appendChild(checkbox);
    label.append(status);

    // Sibling of the label (not nested inside it), so clicking it doesn't
    // also toggle the visibility checkbox via the label's native behavior.
    const notifyBtn = document.createElement('button');
    notifyBtn.type = 'button';
    notifyBtn.className = 'status-notify-toggle';

    const refreshNotifyBtn = () => {
      const muted = notificationDisabledStatuses.has(status);
      notifyBtn.textContent = muted ? '🔕' : '🔔';
      notifyBtn.classList.toggle('muted', muted);
      notifyBtn.setAttribute('aria-label', muted ? `Enable alarms for ${status}` : `Mute alarms for ${status}`);
      notifyBtn.title = muted
        ? 'Alarms muted for this status — click to re-enable'
        : 'Alarms enabled for this status — click to mute';
    };
    refreshNotifyBtn();

    notifyBtn.addEventListener('click', () => {
      if (notificationDisabledStatuses.has(status)) notificationDisabledStatuses.delete(status);
      else notificationDisabledStatuses.add(status);
      localStorage.setItem(
        'tradcal-notification-disabled-statuses',
        JSON.stringify([...notificationDisabledStatuses])
      );
      refreshNotifyBtn();
      renderEvents(latestSnapshot.events);
    });

    row.append(label, notifyBtn);
    statusDropdownPanelEl.appendChild(row);
  }

  updateStatusDropdownToggleLabel(statuses.length);
}

statusDropdownToggleEl.addEventListener('click', (event) => {
  event.stopPropagation();
  statusDropdownPanelEl.classList.toggle('hidden');
});

document.addEventListener('click', (event) => {
  if (!statusDropdownEl.contains(event.target)) {
    statusDropdownPanelEl.classList.add('hidden');
  }
});

// Settings is a full modal (like the history viewer) rather than a small
// anchored dropdown, so its content — theme, display toggles, actions, and
// the technician roster — reads more easily than in a cramped popover.
settingsToggleEl.addEventListener('click', () => {
  statusDropdownPanelEl.classList.add('hidden');
  settingsOverlayEl.classList.remove('hidden');
});

settingsCloseEl.addEventListener('click', () => settingsOverlayEl.classList.add('hidden'));
settingsOverlayEl.addEventListener('click', (event) => {
  if (event.target === settingsOverlayEl) settingsOverlayEl.classList.add('hidden');
});

// --- Clock ---

function tickClock() {
  clockEl.textContent = new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  updateStaleBanner();
}
setInterval(tickClock, 1000);
tickClock();

// --- Filter option population ---

function populateFilterOptions(selectEl, values) {
  const previousValue = selectEl.value || 'all';
  const options = ['all', ...values];

  selectEl.innerHTML = '';
  for (const value of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value === 'all' ? 'All' : value;
    selectEl.appendChild(option);
  }

  selectEl.value = options.includes(previousValue) ? previousValue : 'all';
}

// The person dropdown's options are derived from whoever's on the calendar
// right now, so a saved filter value can only be applied once those options
// exist — this flag makes that restore happen exactly once, on the first
// render after page load, rather than fighting the user's live selection on
// every subsequent render.
let personFilterRestored = false;

function updateFilterOptions(events) {
  const statuses = [
    ...new Set(events.map((e) => getStatusAndTechnician(e.categories, technicians).status).filter(Boolean)),
  ].sort();
  const persons = [...new Set(events.map((e) => displayPerson(e.person)).filter((p) => p && p !== '-'))].sort();
  populateStatusDropdown(statuses);
  populateFilterOptions(personFilterEl, persons);

  if (!personFilterRestored) {
    personFilterRestored = true;
    const saved = localStorage.getItem('tradcal-person-filter');
    if (saved && [...personFilterEl.options].some((o) => o.value === saved)) {
      personFilterEl.value = saved;
    }
  }
}

// --- Appointment table rendering ---

function renderEvents(events) {
  const now = new Date();
  updateFilterOptions(events);

  const filtered = filterEvents(events, {
    now,
    excludedStatuses,
    personFilter: personFilterEl.value,
    technicianFilter: technicianFilterEl.value,
    technicianRoster: technicians,
    showCompleted: showCompletedEl.checked,
    showOverdue: showOverdueEl.checked,
    showFuture: showFutureEl.checked,
    searchText: searchInputEl.value,
  });

  displayedEventIds = new Set(filtered.map((e) => e.id));
  renderAlarms(latestSnapshot.alarms);
  updateIndicatorBadges(filtered);

  bodyEl.innerHTML = '';

  if (filtered.length === 0) {
    emptyStateEl.textContent =
      events.length === 0 ? 'No appointments to show.' : 'No appointments match the current filters.';
    emptyStateEl.classList.remove('hidden');
    return;
  }
  emptyStateEl.classList.add('hidden');

  const sorted = sortByStart(filtered);
  const nextUpcoming = findNextUpcoming(sorted, now);
  const todayStart = startOfDay(now);
  const tomorrowStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 1);
  let todayDividerInserted = false;
  let futureDividerInserted = false;

  for (const event of sorted) {
    const start = new Date(event.start);
    const end = new Date(event.end);
    const { status, technician } = getStatusAndTechnician(event.categories, technicians);
    const person = displayPerson(event.person);
    const completed = isCompletedStatus(status);
    const isOngoing = start <= now && now < end;
    const isOverdue = end <= now && !completed;

    if (!todayDividerInserted && start >= todayStart && bodyEl.children.length > 0) {
      const divider = document.createElement('tr');
      divider.className = 'day-divider';
      divider.innerHTML = `<td colspan="8"><span>Today</span></td>`;
      bodyEl.appendChild(divider);
    }
    if (start >= todayStart) todayDividerInserted = true;

    // Marks where appointments beyond today begin — only relevant with
    // "Show future appointments" on, since otherwise nothing past the
    // near-term cutoff is in `sorted` at all.
    if (!futureDividerInserted && start >= tomorrowStart && bodyEl.children.length > 0) {
      const divider = document.createElement('tr');
      divider.className = 'day-divider future-divider';
      divider.innerHTML = `<td colspan="8"><span>Future</span></td>`;
      bodyEl.appendChild(divider);
    }
    if (start >= tomorrowStart) futureDividerInserted = true;

    const row = document.createElement('tr');

    if (end <= now && completed) row.classList.add('past');
    if (isOverdue) row.classList.add('overdue');
    if (isOngoing) row.classList.add('ongoing');
    if (nextUpcoming && event.id === nextUpcoming.id) row.classList.add('next-upcoming');

    const isNext = Boolean(nextUpcoming && event.id === nextUpcoming.id);

    row.innerHTML = `
      <td class="date-column"><span class="date-text">${start.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></td>
      <td class="next-indicator-column">${isNext ? '<span class="next-indicator">▶</span>' : ''}</td>
      <td class="time-column">${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</td>
      <td>${escapeHtml(event.subject)}</td>
      <td>${escapeHtml(event.location)}</td>
      <td>${escapeHtml(person)}</td>
      <td class="technician-column"><span class="technician-text">${escapeHtml(technician)}</span></td>
      <td><span class="status-badge ${statusColorClass(status)}">${escapeHtml(status)}</span></td>
    `;
    bodyEl.appendChild(row);
  }
}

// --- Alarms ---
//
// The 5-minute alarm is the "urgent" one: it loops continuously (not just a
// single replay per ~20s rebroadcast) using alarm.mp3, and stays up until
// someone clicks Dismiss — it's the last warning before the appointment
// starts, so it shouldn't be easy to miss or auto-dismiss.
//
// The 30- and 15-minute alarms are early heads-up notices: a single ping
// (ping.mp3), no dismiss needed, and the banner clears itself after 60
// seconds regardless of what the server keeps reporting.

const PING_DISPLAY_MS = 60_000;
let pingHideTimeoutId = null;

function clearPingTimeout() {
  if (pingHideTimeoutId) {
    clearTimeout(pingHideTimeoutId);
    pingHideTimeoutId = null;
  }
}

function playAlarmSound() {
  alarmSound.loop = false;
  alarmSound.currentTime = 0;
  return alarmSound.play().catch((err) => {
    // Autoplay may be blocked until the page has had a user interaction;
    // on a kiosk display, click once after load to unlock audio. Logged
    // (rather than silently swallowed) so a real failure — bad file,
    // decode error — is actually diagnosable instead of just "nothing
    // happens."
    console.error('Alarm sound failed to play:', err);
    throw err;
  });
}

// Starts the sound looping if it isn't already — safe to call repeatedly
// (e.g. once per ~20s rebroadcast) without restarting playback each time.
function startAlarmLoop() {
  alarmSound.loop = true;
  if (!alarmSound.paused) return;
  alarmSound.currentTime = 0;
  alarmSound.play().catch((err) => {
    console.error('Alarm sound failed to play:', err);
  });
}

function stopAlarmLoop() {
  alarmSound.loop = false;
  alarmSound.pause();
  alarmSound.currentTime = 0;
}

const PING_REPEAT_COUNT = 3;
let pingChainHandler = null;

// Plays the ping sound PING_REPEAT_COUNT times back-to-back (chained off the
// audio element's own "ended" event, so each play waits for the previous
// one to actually finish rather than overlapping). Used for every
// non-urgent alert — 30/15-min heads-up, new-appointment ping, and both
// their Settings test buttons.
function playPingSound() {
  if (pingChainHandler) {
    pingSound.removeEventListener('ended', pingChainHandler);
    pingChainHandler = null;
  }

  let playsRemaining = PING_REPEAT_COUNT;

  const playNext = () => {
    if (playsRemaining <= 0) {
      pingSound.removeEventListener('ended', playNext);
      pingChainHandler = null;
      return;
    }
    playsRemaining--;
    pingSound.currentTime = 0;
    pingSound.play().catch((err) => {
      console.error('Ping sound failed to play:', err);
      pingSound.removeEventListener('ended', playNext);
      pingChainHandler = null;
    });
  };

  pingChainHandler = playNext;
  pingSound.addEventListener('ended', playNext);
  playNext();
}

function fillBannerContent(alarm) {
  const event = latestSnapshot.events.find((e) => e.id === alarm.eventId);

  alarmBannerTitleEl.textContent = `⏰ Starts in ${alarm.thresholdMinutes} min — ${alarm.subject}`;

  if (event) {
    const start = new Date(event.start);
    const time = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const person = displayPerson(event.person);
    const { technician } = getStatusAndTechnician(event.categories, technicians);
    const details = [
      time,
      event.location,
      person !== '-' ? person : null,
      technician !== '-' ? technician : null,
    ]
      .filter(Boolean)
      .join('  ·  ');
    alarmBannerDetailsEl.textContent = details;
  } else {
    alarmBannerDetailsEl.textContent = '';
  }
}

// Only alarm for appointments that are actually visible on the board right
// now (respecting search/status/person/technician filters) and never for
// ones marked completed — regardless of whether "Show completed" happens to
// be on, a finished appointment should never trigger an alert.
function eligibleAlarms(alarms) {
  return alarms.filter((alarm) => {
    if (!displayedEventIds.has(alarm.eventId)) return false;
    const event = latestSnapshot.events.find((e) => e.id === alarm.eventId);
    if (!event) return false;
    const { status } = getStatusAndTechnician(event.categories, technicians);
    if (isCompletedStatus(status)) return false;
    return !notificationDisabledStatuses.has(status);
  });
}

function renderAlarms(rawAlarms) {
  // A manually-triggered test alarm takes precedence until dismissed —
  // otherwise the next real snapshot (every ~20s) would immediately hide
  // the test banner just because there's no real alarm active right now.
  if (testAlarmActive) return;

  const alarms = eligibleAlarms(rawAlarms);

  if (alarms.length === 0) {
    bannerEl.classList.add('hidden');
    currentAlarmKey = null;
    stopAlarmLoop();
    clearPingTimeout();
    return;
  }

  const alarm = alarms[0];
  const key = `${alarm.eventId}-${alarm.thresholdMinutes}`;
  const isUrgent = alarm.thresholdMinutes === 5;

  if (!isUrgent) {
    // Early heads-up: only act the first time this specific alarm is seen —
    // once shown, its own 60s timer owns hiding it, regardless of how many
    // more times the server reports it active before that window passes.
    if (key === currentAlarmKey) return;

    currentAlarmKey = key;
    stopAlarmLoop(); // in case a previous urgent alarm was still looping
    clearPingTimeout();
    alarmDismissEl.classList.add('hidden');
    fillBannerContent(alarm);
    bannerEl.classList.remove('hidden');
    playPingSound();
    pingHideTimeoutId = setTimeout(() => {
      bannerEl.classList.add('hidden');
      pingHideTimeoutId = null;
    }, PING_DISPLAY_MS);
    return;
  }

  // Urgent (5-min) alarm — takes over from any pending ping immediately.
  currentAlarmKey = key;
  clearPingTimeout();
  alarmDismissEl.classList.remove('hidden');

  if (key === dismissedAlarmKey) {
    bannerEl.classList.add('hidden');
    stopAlarmLoop();
    return;
  }

  fillBannerContent(alarm);
  bannerEl.classList.remove('hidden');
  startAlarmLoop();
}

alarmDismissEl.addEventListener('click', () => {
  dismissedAlarmKey = currentAlarmKey;
  testAlarmActive = false;
  bannerEl.classList.add('hidden');
  stopAlarmLoop();
});

// --- New appointment ping ---
//
// Pings (same as a 30/15-min heads-up) when an appointment scheduled for
// today first shows up in the data — e.g. someone books a same-day
// appointment while the board is already running. Doesn't fire for the
// board's very first snapshot (that would ping for every appointment
// already on today's calendar at page load), and won't interrupt an
// urgent (dismiss-required) alarm that's currently showing.

let knownEventIds = null;

function pingForNewAppointment(event) {
  const key = `new-${event.id}`;
  if (key === currentAlarmKey) return;

  currentAlarmKey = key;
  stopAlarmLoop();
  clearPingTimeout();
  alarmDismissEl.classList.add('hidden');

  const start = new Date(event.start);
  const time = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const person = displayPerson(event.person);
  const { technician } = getStatusAndTechnician(event.categories, technicians);
  const details = [time, event.location, person !== '-' ? person : null, technician !== '-' ? technician : null]
    .filter(Boolean)
    .join('  ·  ');

  alarmBannerTitleEl.textContent = `🆕 New appointment today — ${event.subject}`;
  alarmBannerDetailsEl.textContent = details;
  bannerEl.classList.remove('hidden');
  playPingSound();

  pingHideTimeoutId = setTimeout(() => {
    bannerEl.classList.add('hidden');
    pingHideTimeoutId = null;
  }, PING_DISPLAY_MS);
}

function checkForNewAppointments(events) {
  const currentIds = new Set(events.map((e) => e.id));

  if (knownEventIds === null) {
    knownEventIds = currentIds;
    return;
  }

  const urgentShowing = !bannerEl.classList.contains('hidden') && !alarmDismissEl.classList.contains('hidden');

  if (!urgentShowing) {
    const now = new Date();
    const todayStart = startOfDay(now);
    const tomorrowStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + 1);

    for (const event of events) {
      if (knownEventIds.has(event.id)) continue;
      const start = new Date(event.start);
      if (start < todayStart || start >= tomorrowStart) continue;
      const { status } = getStatusAndTechnician(event.categories, technicians);
      if (notificationDisabledStatuses.has(status)) continue;
      pingForNewAppointment(event);
    }
  }

  knownEventIds = currentIds;
}

const TEST_ALARM_DEFAULT_LABEL = '🔊 Test alarm sound';
const TEST_ALARM_KEY = 'test-alarm';

testAlarmEl.addEventListener('click', () => {
  testAlarmActive = true;
  currentAlarmKey = TEST_ALARM_KEY;
  if (dismissedAlarmKey === TEST_ALARM_KEY) dismissedAlarmKey = null;
  clearPingTimeout();
  alarmDismissEl.classList.remove('hidden');

  alarmBannerTitleEl.textContent = '⏰ TEST ALARM — this is only a test';
  alarmBannerDetailsEl.textContent = 'Triggered manually from Settings · Dismiss to stop';
  bannerEl.classList.remove('hidden');
  startAlarmLoop();

  testAlarmEl.textContent = '✅ Showing banner…';
  setTimeout(() => {
    testAlarmEl.textContent = TEST_ALARM_DEFAULT_LABEL;
  }, 2500);
});

const TEST_PING_DEFAULT_LABEL = '🔔 Test ping sound';
const TEST_PING_KEY = 'test-ping';

testPingEl.addEventListener('click', () => {
  testAlarmActive = true;
  currentAlarmKey = TEST_PING_KEY;
  stopAlarmLoop(); // in case an urgent test/alarm was mid-loop
  clearPingTimeout();
  alarmDismissEl.classList.add('hidden');

  alarmBannerTitleEl.textContent = '🔔 TEST PING — this is only a test';
  alarmBannerDetailsEl.textContent = 'Triggered manually from Settings · Clears itself in 60s';
  bannerEl.classList.remove('hidden');
  playPingSound();

  // No dismiss button for ping-style alerts, so this timer is the only
  // thing that clears both the banner and the testAlarmActive lock —
  // without resetting the flag here it would stay stuck forever, since
  // there's no dismiss click to do it.
  pingHideTimeoutId = setTimeout(() => {
    bannerEl.classList.add('hidden');
    pingHideTimeoutId = null;
    testAlarmActive = false;
  }, PING_DISPLAY_MS);

  testPingEl.textContent = '✅ Showing banner…';
  setTimeout(() => {
    testPingEl.textContent = TEST_PING_DEFAULT_LABEL;
  }, 2500);
});

const TEST_NEW_APPOINTMENT_DEFAULT_LABEL = '🆕 Test new appointment message';
const TEST_NEW_APPOINTMENT_KEY = 'test-new-appointment';

testNewAppointmentEl.addEventListener('click', () => {
  testAlarmActive = true;
  currentAlarmKey = TEST_NEW_APPOINTMENT_KEY;
  stopAlarmLoop();
  clearPingTimeout();
  alarmDismissEl.classList.add('hidden');

  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  alarmBannerTitleEl.textContent = '🆕 New appointment today — Sample Appointment';
  alarmBannerDetailsEl.textContent = `${time}  ·  Test Location  ·  Triggered manually from Settings`;
  bannerEl.classList.remove('hidden');
  playPingSound();

  pingHideTimeoutId = setTimeout(() => {
    bannerEl.classList.add('hidden');
    pingHideTimeoutId = null;
    testAlarmActive = false;
  }, PING_DISPLAY_MS);

  testNewAppointmentEl.textContent = '✅ Showing banner…';
  setTimeout(() => {
    testNewAppointmentEl.textContent = TEST_NEW_APPOINTMENT_DEFAULT_LABEL;
  }, 2500);
});

// --- Mock-mode badge ---

function renderMockBadge(mockMode) {
  mockBadgeEl.classList.toggle('hidden', !mockMode);
}

// --- Filter / mute indicator badges ---
//
// Someone glancing at the kiosk from across the room has no way to tell a
// filter is narrowing what's shown, or that a status's alarms are muted —
// both now persist across reloads, so a choice made once could otherwise go
// unnoticed indefinitely. These badges (next to the DEMO DATA one) surface
// that state; clicking either opens Settings so it can be reviewed/reset.
// Only counts toggles that actively *hide* data as "filtered" — showCompleted
// off and showFuture off are the app's own shipped defaults, not something a
// user did to narrow the view, so they don't trigger the badge.

const MUTE_BADGE_DEFAULT_TEXT = muteBadgeEl.textContent;
const MUTE_BADGE_DEFAULT_TITLE = muteBadgeEl.title;

// `displayedEvents` is the post-filter list actually on the board right now
// (renderEvents() passes its `filtered` array) — a status that's muted but
// currently hidden by the visibility checkbox isn't worth warning about,
// since nothing muted is actually on screen to be missed.
function updateIndicatorBadges(displayedEvents) {
  const filtering =
    excludedStatuses.size > 0 ||
    personFilterEl.value !== 'all' ||
    technicianFilterEl.value !== 'all' ||
    searchInputEl.value.trim() !== '' ||
    !showOverdueEl.checked;
  filterBadgeEl.classList.toggle('hidden', !filtering);

  const mutedVisibleStatuses = [
    ...new Set(
      displayedEvents
        .map((e) => getStatusAndTechnician(e.categories, technicians).status)
        .filter((status) => notificationDisabledStatuses.has(status))
    ),
  ];

  muteBadgeEl.classList.toggle('hidden', mutedVisibleStatuses.length === 0);
  if (mutedVisibleStatuses.length > 0) {
    const names = mutedVisibleStatuses.join(', ');
    muteBadgeEl.textContent = `🔕 Alerts muted: ${names}`;
    muteBadgeEl.title = `Alarms are muted for: ${names} — open Settings to review`;
  } else {
    muteBadgeEl.textContent = MUTE_BADGE_DEFAULT_TEXT;
    muteBadgeEl.title = MUTE_BADGE_DEFAULT_TITLE;
  }
}

for (const badge of [filterBadgeEl, muteBadgeEl]) {
  badge.addEventListener('click', () => settingsOverlayEl.classList.remove('hidden'));
}

// --- Action error banner ---
//
// Distinct from the stale-data banner above (which reflects the Graph
// polling loop): this one surfaces failures from direct user actions in
// Settings — saving/loading the technician roster — that would otherwise
// only land in the console, invisible on an unattended kiosk display.

const ACTION_ERROR_DISPLAY_MS = 8_000;
let actionErrorTimeoutId = null;

function showActionError(message) {
  actionErrorBannerEl.textContent = message;
  actionErrorBannerEl.classList.remove('hidden');
  if (actionErrorTimeoutId) clearTimeout(actionErrorTimeoutId);
  actionErrorTimeoutId = setTimeout(() => {
    actionErrorBannerEl.classList.add('hidden');
    actionErrorTimeoutId = null;
  }, ACTION_ERROR_DISPLAY_MS);
}

// --- Stale-data / failure banner ---

function updateStaleBanner() {
  const { lastUpdated, pollIntervalSeconds, consecutiveFailures, lastError } = latestSnapshot;

  if (!lastUpdated) {
    lastUpdatedEl.textContent = '';
    staleBannerEl.textContent = lastError
      ? `Unable to load appointment data: ${lastError}`
      : 'Waiting for the first data update…';
    staleBannerEl.classList.remove('hidden');
    return;
  }

  const updatedAt = new Date(lastUpdated);
  lastUpdatedEl.textContent = `Data updated ${updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;

  const staleThresholdMs = Math.max(pollIntervalSeconds * 3, 180) * 1000;
  const isStale = Date.now() - updatedAt.getTime() > staleThresholdMs;

  if (isStale) {
    staleBannerEl.textContent =
      consecutiveFailures > 0
        ? `Data feed hasn't updated recently (${consecutiveFailures} failed attempts — ${lastError}).`
        : "Data feed hasn't updated recently — this board may be showing stale information.";
  }
  staleBannerEl.classList.toggle('hidden', !isStale);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function renderAll() {
  // renderEvents() calls renderAlarms() itself once it knows which events
  // are actually displayed (alarms are gated to those) — no separate call
  // needed here.
  renderEvents(latestSnapshot.events);
  renderMockBadge(latestSnapshot.mockMode);
  updateStaleBanner();
}

personFilterEl.addEventListener('change', () => {
  localStorage.setItem('tradcal-person-filter', personFilterEl.value);
  renderEvents(latestSnapshot.events);
});

function applyShowCompleted(shouldShow) {
  showCompletedEl.checked = shouldShow;
  localStorage.setItem('tradcal-show-completed', String(shouldShow));
  renderEvents(latestSnapshot.events);
}
applyShowCompleted(localStorage.getItem('tradcal-show-completed') === 'true');
showCompletedEl.addEventListener('change', () => applyShowCompleted(showCompletedEl.checked));

function applyShowOverdue(shouldShow) {
  showOverdueEl.checked = shouldShow;
  localStorage.setItem('tradcal-show-overdue', String(shouldShow));
  renderEvents(latestSnapshot.events);
}
// Defaults to checked (matches the HTML default) when nothing's been saved yet.
const storedShowOverdue = localStorage.getItem('tradcal-show-overdue');
applyShowOverdue(storedShowOverdue === null ? true : storedShowOverdue === 'true');
showOverdueEl.addEventListener('change', () => applyShowOverdue(showOverdueEl.checked));

searchInputEl.value = localStorage.getItem('tradcal-search-text') ?? '';
searchInputEl.addEventListener('input', () => {
  localStorage.setItem('tradcal-search-text', searchInputEl.value);
  renderEvents(latestSnapshot.events);
});

// --- Date column toggle (persisted) ---

function applyShowDate(shouldShow) {
  showDateEl.checked = shouldShow;
  appointmentsTableEl.classList.toggle('hide-date-column', !shouldShow);
  localStorage.setItem('tradcal-show-date', String(shouldShow));
}

applyShowDate(localStorage.getItem('tradcal-show-date') === 'true');
showDateEl.addEventListener('change', () => applyShowDate(showDateEl.checked));

// --- Future-appointments toggle (persisted) ---
//
// The server fetches a wide window (LOOKAHEAD_MINUTES, often days) so
// overdue/history logic has real data, but the board itself only shows the
// next few hours by default — this reveals the rest of that window.

function applyShowFuture(shouldShow) {
  showFutureEl.checked = shouldShow;
  localStorage.setItem('tradcal-show-future', String(shouldShow));
  renderEvents(latestSnapshot.events);
}

applyShowFuture(localStorage.getItem('tradcal-show-future') === 'true');
showFutureEl.addEventListener('change', () => applyShowFuture(showFutureEl.checked));

// --- Manual refresh ---

refreshNowEl.addEventListener('click', () => window.location.reload());

// --- Reset filters & alarm mutes ---
//
// Everything above now persists to localStorage (see the individual
// apply*/change-listener pairs), which means there's otherwise no way back
// to defaults short of clearing browser storage by hand. On an unattended
// kiosk, a filter or mute left on by accident could silently under-report
// appointments/alerts for weeks with nobody noticing — this button clears
// just the filtering/muting state (not theme or the date-column/show-future
// display toggles, which are cosmetic preferences rather than things that
// hide data).

const RESET_FILTERS_DEFAULT_LABEL = resetFiltersEl.textContent;

function resetFiltersAndMutes() {
  excludedStatuses.clear();
  notificationDisabledStatuses.clear();
  localStorage.removeItem('tradcal-excluded-statuses');
  localStorage.removeItem('tradcal-notification-disabled-statuses');

  personFilterEl.value = 'all';
  localStorage.removeItem('tradcal-person-filter');

  technicianFilterEl.value = 'all';
  localStorage.removeItem('tradcal-technician-filter');

  searchInputEl.value = '';
  localStorage.removeItem('tradcal-search-text');

  applyShowCompleted(false);
  applyShowOverdue(true);

  renderEvents(latestSnapshot.events);
}

resetFiltersEl.addEventListener('click', () => {
  resetFiltersAndMutes();
  resetFiltersEl.textContent = '✅ Filters reset';
  setTimeout(() => {
    resetFiltersEl.textContent = RESET_FILTERS_DEFAULT_LABEL;
  }, 2000);
});

// --- Technician roster (managed by hand in Settings) ---
//
// Distinct from the "Users" dropdown above, which is auto-derived from
// whoever's actually assigned on the calendar (the requester). This list
// starts empty and is populated manually with technician first names,
// matching the Outlook category a technician tags their own appointments
// with (see getStatusAndTechnician in logic.js — technicians are
// identified by category now, not by being invited to the event).
//
// Persisted server-side (server/technicians.csv) rather than in this
// browser's localStorage, so the roster is the same regardless of which
// device/browser someone edits it from, and survives a browser reset.
// (`technicians` itself is declared near the top of the file — see there.)

async function saveTechnicians() {
  try {
    const response = await fetch('/api/technicians', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(technicians),
    });
    if (!response.ok) throw new Error(`server responded ${response.status}`);
  } catch (err) {
    console.error('Failed to save technician roster:', err);
    showActionError('Failed to save the technician roster — your change may not persist.');
  }
}

async function loadTechnicians() {
  try {
    const response = await fetch('/api/technicians');
    if (!response.ok) throw new Error(`server responded ${response.status}`);
    technicians = await response.json();
  } catch (err) {
    console.error('Failed to load technician roster:', err);
    showActionError('Failed to load the technician roster from the server.');
    technicians = [];
  }
  renderTechnicianList();
  populateTechnicianDropdown();
  renderEvents(latestSnapshot.events);
}

// Restored from localStorage on the first populate (once the roster has
// loaded) — like personFilterRestored above, this shouldn't fight the
// user's live selection on later calls (e.g. after adding/removing a
// technician in Settings).
let technicianFilterRestored = false;

function populateTechnicianDropdown() {
  const previousValue = technicianFilterEl.value || 'all';
  technicianFilterEl.innerHTML = '<option value="all">All</option>';
  for (const name of technicians) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    technicianFilterEl.appendChild(option);
  }
  technicianFilterEl.value = ['all', ...technicians].includes(previousValue) ? previousValue : 'all';

  if (!technicianFilterRestored) {
    technicianFilterRestored = true;
    const saved = localStorage.getItem('tradcal-technician-filter');
    if (saved && ['all', ...technicians].includes(saved)) {
      technicianFilterEl.value = saved;
    }
  }
}

function renderTechnicianList() {
  technicianListEl.innerHTML = '';
  for (const name of technicians) {
    const item = document.createElement('li');
    item.className = 'technician-item';

    const label = document.createElement('span');
    label.textContent = name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'technician-remove';
    removeBtn.setAttribute('aria-label', `Remove ${name}`);
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      technicians = technicians.filter((n) => n !== name);
      saveTechnicians();
      renderTechnicianList();
      populateTechnicianDropdown();
      renderEvents(latestSnapshot.events);
    });

    item.append(label, removeBtn);
    technicianListEl.appendChild(item);
  }
}

function addTechnician() {
  const name = technicianEmailInputEl.value.trim();
  if (!name) return;

  if (!technicians.includes(name)) {
    technicians.push(name);
    saveTechnicians();
    renderTechnicianList();
    populateTechnicianDropdown();
  }
  technicianEmailInputEl.value = '';
}

technicianAddBtnEl.addEventListener('click', addTechnician);
technicianEmailInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addTechnician();
  }
});
technicianFilterEl.addEventListener('change', () => {
  localStorage.setItem('tradcal-technician-filter', technicianFilterEl.value);
  renderEvents(latestSnapshot.events);
});

loadTechnicians();

// --- Appointment history (archive) viewer ---

function renderHistory(records) {
  if (records.length === 0) {
    historyBodyEl.textContent = 'No archived appointments yet.';
    return;
  }

  const sorted = [...records].sort((a, b) => new Date(b.end) - new Date(a.end));
  const rows = sorted
    .map((r) => {
      const person = displayPerson(r.person);
      const { status, technician } = getStatusAndTechnician(r.categories, technicians);
      return `
        <tr>
          <td>${escapeHtml(new Date(r.end).toLocaleDateString())}</td>
          <td>${escapeHtml(r.subject)}</td>
          <td>${escapeHtml(r.location)}</td>
          <td>${escapeHtml(person)}</td>
          <td class="technician-column"><span class="technician-text">${escapeHtml(technician)}</span></td>
          <td><span class="status-badge ${statusColorClass(status)}">${escapeHtml(status)}</span></td>
        </tr>
      `;
    })
    .join('');

  historyBodyEl.innerHTML = `
    <table>
      <thead><tr><th>Date</th><th>Title</th><th>Location</th><th>Person</th><th class="technician-column">Technician</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

openHistoryEl.addEventListener('click', async () => {
  historyOverlayEl.classList.remove('hidden');
  historyBodyEl.textContent = 'Loading…';
  try {
    const response = await fetch('/api/archive');
    renderHistory(await response.json());
  } catch {
    historyBodyEl.textContent = 'Failed to load appointment history.';
  }
});

historyCloseEl.addEventListener('click', () => historyOverlayEl.classList.add('hidden'));
historyOverlayEl.addEventListener('click', (event) => {
  if (event.target === historyOverlayEl) historyOverlayEl.classList.add('hidden');
});

// --- Live data stream ---

const source = new EventSource('/api/stream');
source.onmessage = (msg) => {
  latestSnapshot = JSON.parse(msg.data);
  renderAll();
  // After renderAll (which may show/clear an urgent alarm), so a genuinely
  // new same-day appointment never interrupts one already in progress.
  checkForNewAppointments(latestSnapshot.events);
};

// Appointment data already updates live via the SSE stream above — this is
// a separate safety net for a kiosk tab that stays open unattended for
// days/weeks: a full page reload periodically resets any accumulated
// browser-side state (memory growth, a stuck connection) rather than
// relying on the tab staying healthy indefinitely.
const AUTO_RELOAD_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
setInterval(() => window.location.reload(), AUTO_RELOAD_INTERVAL_MS);
