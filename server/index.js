import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { refreshEvents, getCachedEvents, computeActiveAlarms, backfillArchive } from './appointmentStore.js';
import { readArchive } from './archive.js';
import { readRoster, writeRoster } from './technicianRoster.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT ?? 3000;
const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS ?? 60);

// Warn (don't block boot — the kiosk page should still load while waiting
// on Azure setup) if required Graph config is missing.
if (process.env.USE_MOCK_DATA !== 'true') {
  const required = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'CALENDAR_MAILBOX'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.warn(`Missing required .env values: ${missing.join(', ')} — Graph calls will fail until set.`);
  }
}

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Server-Sent Events: pushes the appointment list + active alarms to the
// kiosk display whenever the backend re-polls Microsoft Graph.
const sseClients = new Set();

app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  sseClients.add(res);
  sendSnapshot(res);

  req.on('close', () => sseClients.delete(res));
});

// Only updated on a successful poll, so a run of failed Graph calls leaves
// this timestamp aging — the client uses that to show a stale-data warning.
let lastUpdatedAt = null;
let consecutiveFailures = 0;
let lastError = null;

app.get('/api/archive', (req, res) => {
  res.json(readArchive());
});

app.get('/api/technicians', (req, res) => {
  res.json(readRoster());
});

// Replaces the whole roster with the given list — simpler than separate
// add/remove endpoints for a list this small, and the client always has
// the full current list in memory anyway.
app.put('/api/technicians', (req, res) => {
  if (!Array.isArray(req.body)) {
    res.status(400).json({ error: 'Expected a JSON array of technician names' });
    return;
  }
  res.json(writeRoster(req.body));
});

function sendSnapshot(res) {
  const events = getCachedEvents();
  const alarms = computeActiveAlarms(events);
  res.write(
    `data: ${JSON.stringify({
      events,
      alarms,
      lastUpdated: lastUpdatedAt ? lastUpdatedAt.toISOString() : null,
      mockMode: process.env.USE_MOCK_DATA === 'true',
      pollIntervalSeconds: POLL_INTERVAL_SECONDS,
      consecutiveFailures,
      lastError,
    })}\n\n`
  );
}

function broadcastSnapshot() {
  for (const client of sseClients) sendSnapshot(client);
}

async function pollGraph() {
  try {
    await refreshEvents();
    lastUpdatedAt = new Date();
    consecutiveFailures = 0;
    lastError = null;
  } catch (err) {
    consecutiveFailures += 1;
    lastError = err.message;
    console.error(
      `Failed to refresh events from Microsoft Graph (${consecutiveFailures} consecutive failures):`,
      err.message
    );
  }
  broadcastSnapshot();
}

// Re-check alarm thresholds every 20s independent of the Graph poll interval,
// since alarms are minute-sensitive but Graph polling can be slower. Driven
// off a single timer (rather than a separate setInterval per concern) so a
// poll tick and a recheck tick can never land close together and broadcast
// two SSE frames back to back for what's logically one update.
const RECHECK_INTERVAL_SECONDS = 20;
let secondsSinceLastPoll = 0;

setInterval(async () => {
  secondsSinceLastPoll += RECHECK_INTERVAL_SECONDS;
  if (secondsSinceLastPoll >= POLL_INTERVAL_SECONDS) {
    secondsSinceLastPoll = 0;
    await pollGraph(); // pollGraph() broadcasts once it has fresh data
  } else {
    broadcastSnapshot();
  }
}, RECHECK_INTERVAL_SECONDS * 1000);

pollGraph();

backfillArchive().catch((err) => {
  console.error('Failed to backfill appointment history from Microsoft Graph:', err.message);
});

app.listen(PORT, () => {
  console.log(`TRADCAL server listening on http://localhost:${PORT}`);
});
