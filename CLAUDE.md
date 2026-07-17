# TRADCAL

Technician appointment board for a shared monitor in the technician area. Pulls
appointments from a shared Outlook calendar via Microsoft Graph and displays
them on a kiosk screen, firing visual + audio alarms at 30, 15, and 5 minutes
before each appointment starts.

## Architecture

- **Data source**: a single shared Outlook calendar (one mailbox, all
  technician appointments booked on it — not per-technician calendars).
- **Backend** (`server/`): Node + Express. Polls Microsoft Graph's
  `calendarView` endpoint on a timer (`POLL_INTERVAL_SECONDS`), caches the
  upcoming events in memory, and pushes updates to connected displays over
  Server-Sent Events (`/api/stream`).
  - `server/graphClient.js` — auth (MSAL client-credentials flow, app-only
    permissions, no user login) and the Graph API call. Queries a rolling
    window from `LOOKBACK_MINUTES` in the past to `LOOKAHEAD_MINUTES` (default
    7 days) in the future, following `@odata.nextLink` pagination. "Person" is
    read from event **attendees**, not the organizer — every appointment on
    this shared calendar is organized by the shared mailbox itself, so the
    organizer field is always the same placeholder identity ("Technician,
    InfoTech") and useless for identifying who's actually involved. Multiple
    attendee names are joined with `" / "` (not `", "` — each name is itself
    "Last, First", so a comma-only join makes multi-attendee events
    ambiguous, e.g. is "Lion, Tamara, Meadows, David" one person or two?).
  - `server/appointmentStore.js` — in-memory cache of events + alarm
    threshold logic (30/15/5 min before start). Diffs each poll against the
    previous cache and hands anything that aged out of the query window to
    `archive.js`. `backfillArchive()` runs once at startup, pulling the last
    30 days directly from Graph so the archive doesn't start out empty and
    take weeks to reflect real history.
  - `server/archive.js` — appends appointments that have aged off the live
    board to `appointments-archive.csv` (project root, gitignored) and
    prunes it to a rolling 30-day window on every poll. Browsable in the UI
    via Settings → "View appointment history", backed by `GET /api/archive`.
  - `server/technicianRoster.js` — reads/writes `technicians.json` (project
    root, gitignored). Backs the technician roster in Settings; persisted
    server-side (not just the browser's `localStorage`) so it's the same
    regardless of which device someone edits it from, and survives a browser
    reset. `GET`/`PUT /api/technicians` in `server/index.js`.
  - `server/index.js` — Express app, SSE endpoint, polling loop. Tracks
    `consecutiveFailures`/`lastError` across polls and includes them in the
    SSE payload so the frontend can show *why* data is stale, not just that
    it is. Warns at startup (without blocking boot) if required `.env` values
    are missing.
- **Frontend** (`public/`): static HTML/CSS/JS, no build step (loaded as an
  ES module so `app.js` can `import` from `logic.js`). Connects to
  `/api/stream` via `EventSource`, renders the appointment table, and shows a
  full-width banner + plays a sound when an alarm is active. Meant to run
  full-screen in Chrome kiosk mode on the monitor.
  - `public/logic.js` — pure filtering/status/display logic with no DOM
    dependency, so it's unit-testable under Node (`logic.test.js`) instead of
    only being exercisable by hand in a browser. Includes
    `splitPersonAndTechnician()`, which partitions an event's attendee names
    into the **Person** column (the requester) and **Technician** column
    (whoever matches the roster) — an attendee is only "Person" if they're
    neither the shared-mailbox placeholder nor on the technician roster.
  - The board shows only near-term appointments (`NEAR_TERM_HOURS`, 4h) by
    default even though the server fetches much further ahead — Settings →
    "Show future appointments" removes that cutoff to reveal the rest of the
    fetched window.
  - Theme, all filters (status, person, technician, search text, show
    completed/overdue/date/future), and appointments-per-page-style display
    toggles are persisted to `localStorage` (`tradcal-*` keys) so they
    survive both the board's own `AUTO_RELOAD_INTERVAL_MS` self-refresh and a
    manual page reload — this runs unattended, so someone shouldn't have to
    re-apply a filter every few minutes. The person/technician dropdowns
    restore their saved value once, on the first render after their options
    load (`personFilterRestored`/`technicianFilterRestored`), so a saved
    choice doesn't fight a live selection change afterward.
  - Each status in the status filter dropdown has its own 🔔/🔕 mute toggle,
    independent of that status's visibility checkbox — a status can stay
    shown on the board while its alarms/pings are silenced. Muted statuses
    are persisted (`tradcal-notification-disabled-statuses`) and checked in
    `eligibleAlarms()` and `checkForNewAppointments()`.
  - Since filters and mutes now survive reloads indefinitely, two small
    warning badges next to the DEMO DATA one make that state visible from
    across the room instead of silently narrowing the board forever: "⚠
    Filtered view" (a status/person/technician/search filter is actively
    hiding appointments, or past-due ones are hidden) and "🔕 Alerts muted"
    (one or more statuses have alarms muted). Clicking either opens
    Settings. Settings → "Reset filters & alarm mutes" clears all of it in
    one action (but leaves theme and the date-column/show-future display
    toggles alone — those are cosmetic, not something hiding data).
  - An `#action-error-banner` (styled like the stale-data banner, red)
    surfaces failures from direct user actions — currently just
    saving/loading the technician roster — that would otherwise only land
    in the browser console, invisible on an unattended kiosk.
  - Requests a Screen Wake Lock on load (re-requested on visibility change)
    since this runs unattended on a shared monitor and should never sleep.
  - The alarm banner has a **Dismiss** button; until dismissed, the sound
    loops continuously (not just replayed once per ~20s rebroadcast) so it
    can't be missed if no one's nearby the first time. Settings → "Test alarm
    sound" triggers the same banner + loop manually, for verifying it works.
- **Alerts are display-only** — no push notifications to technician phones or
  Teams/Slack. This was an explicit choice to keep the system simple; revisit
  only if asked.

## Why these choices

- Client-credentials (app-only) auth instead of delegated/user auth: the
  display runs unattended with no one logged in, so it can't do an
  interactive OAuth sign-in flow.
- SSE instead of polling from the browser: simpler than WebSockets for a
  one-way server→client push, and every browser supports it natively.
- Alarm thresholds are evaluated as 1-minute windows (see
  `computeActiveAlarms` in `appointmentStore.js`) rather than exact-minute
  matches, so a slow poll tick can't cause an alarm to be silently skipped.
- No database — the appointment list is refetched from Graph on every poll
  and kept in memory only. Outlook is the source of truth; there's nothing
  else to persist.

## Setup

1. Azure AD app registration steps are documented separately in
   `docs/AZURE_SETUP.md` (written to hand off to whoever has Azure admin
   access — covers app registration, the client secret, `Calendars.Read`
   permission + admin consent, and scoping access to just the shared
   mailbox).
2. Copy `.env.example` to `.env` and fill in `AZURE_TENANT_ID`,
   `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and `CALENDAR_MAILBOX` (the
   shared mailbox address) once the admin has those values.
3. `npm install`
4. `npm start` (or `npm run dev` for auto-restart on changes).
5. Open `http://<server-host>:3000` full-screen in Chrome on the kiosk
   machine.

### Developing without Azure access yet

Set `USE_MOCK_DATA=true` in `.env` to serve generated fake appointments
(`server/mockData.js`) instead of calling Microsoft Graph. The mock events
are generated relative to "now" so the 30/15/5-minute alarms actually fire,
which makes it possible to build/test the kiosk display end-to-end before
Azure AD access comes through. Switch back to `false` (or unset) once real
credentials are in `.env`.

## Testing

`npm test` runs everything matching `server/*.test.js` and `public/*.test.js`:
alarm threshold logic and archive read/write/prune on the backend, and the
pure filtering/status/display logic (`public/logic.js`) on the frontend. No
DOM-level frontend tests (dropdowns, SSE wiring, wake lock) — those still
need a manual check in a browser.

## Known gaps / not yet built

- No retry/backoff on Graph API failures beyond the next poll tick — a fixed
  60s retry cadence was judged simple enough not to need variable backoff;
  revisit if Graph rate-limiting becomes a real problem.
- No push notifications (email/Slack/Teams) when polling fails repeatedly —
  `consecutiveFailures`/`lastError` are surfaced on the kiosk display itself
  (stale-data banner) but nothing pages anyone off-site. Deliberately left
  out to keep the system simple; the kiosk is meant to be glanced at
  regularly by people in the technician area.
- `start-kiosk.bat` (project root) starts the server and opens the board in
  Chrome kiosk mode on Windows — run it directly, or point a Windows Task
  Scheduler "run at startup" task at it for full autostart-on-boot. Not
  tested on an actual Windows machine (written/verified on macOS); flag any
  issues if it doesn't behave as expected on the real kiosk PC.
- No authentication and no TLS — anyone who can reach the server's port on
  the local network can view live appointments and the 30-day history via
  `/api/archive`. Fine on a trusted internal LAN (the assumption this whole
  app is built on); revisit if the server is ever reachable more broadly.
- No file-based server logging — output only exists in whatever
  terminal/process is currently running it (`console.log`/`console.error`).
  If run under a process manager (systemd, pm2) for real deployment, use its
  logging rather than this repo's.
- No DOM-level frontend tests — `logic.js` (filtering, status/person
  parsing, alarm-adjacent pure logic) is well covered, but the DOM wiring in
  `app.js` itself (dropdowns, the roster UI, wake lock, SSE handling) has no
  automated tests, only manual browser checks.
