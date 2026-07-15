import { ConfidentialClientApplication } from '@azure/msal-node';
import fetch from 'node-fetch';

let msalApp;

// Created lazily (not at import time) so the server can still boot and serve
// the kiosk page before Azure AD credentials are configured in .env.
function getMsalApp() {
  if (!msalApp) {
    msalApp = new ConfidentialClientApplication({
      auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
      },
    });
  }
  return msalApp;
}

async function getAccessToken() {
  const result = await getMsalApp().acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return result.accessToken;
}

function getAssignedPerson(event) {
  const attendeeNames = (event.attendees ?? [])
    .filter((a) => a.type !== 'resource')
    .map((a) => a.emailAddress?.name)
    .filter(Boolean);

  if (attendeeNames.length > 0) return attendeeNames.join(' / ');
  return event.organizer?.emailAddress?.name ?? '';
}

function mapGraphEvent(event) {
  return {
    id: event.id,
    subject: event.subject,
    start: event.start.dateTime + 'Z',
    end: event.end.dateTime + 'Z',
    location: event.location?.displayName ?? '',
    // "Person" = whoever the appointment is actually for (the requester).
    // On this shared calendar every event is organized by the shared
    // mailbox itself, not the tech doing the work — so the organizer field
    // is useless for this; the actual requester shows up as an attendee
    // instead. Falls back to organizer only if there are no attendees at
    // all.
    person: getAssignedPerson(event),
    // Raw Outlook categories. Both the status (e.g. "In Progress",
    // "Completed") and the assigned technician are categories on the same
    // event — a technician is identified by tagging the event with a
    // category matching their first name (see the technician roster in
    // Settings), not by being invited to it. Which category is "status" vs
    // "technician" is resolved client-side (public/logic.js
    // getStatusAndTechnician), since that depends on the current roster.
    categories: event.categories ?? [],
  };
}

// Fetches every event in [startDateTime, endDateTime), following
// @odata.nextLink pagination — a 30-day backfill window can easily exceed a
// single page (default $top=50) on a busy shared calendar.
export async function fetchEventsInRange(startDateTime, endDateTime) {
  const token = await getAccessToken();
  const mailbox = process.env.CALENDAR_MAILBOX;

  const url = new URL(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/calendarView`
  );
  url.searchParams.set('startDateTime', startDateTime.toISOString());
  url.searchParams.set('endDateTime', endDateTime.toISOString());
  url.searchParams.set('$orderby', 'start/dateTime');
  url.searchParams.set('$top', '50');
  url.searchParams.set(
    '$select',
    'id,subject,start,end,location,organizer,attendees,categories,isAllDay'
  );

  let nextUrl = url.toString();
  const rawEvents = [];

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Graph calendarView request failed: ${response.status} ${body}`);
    }

    const data = await response.json();
    rawEvents.push(...data.value);
    nextUrl = data['@odata.nextLink'] ?? null;
  }

  return rawEvents
    // All-day events are staff OOO/availability blocks on this shared
    // calendar (e.g. "Trevor - Out"), not bookable technician appointments,
    // so they're excluded from the board entirely.
    .filter((event) => !event.isAllDay)
    .map(mapGraphEvent);
}

export async function fetchUpcomingEvents(lookaheadMinutes, lookbackMinutes = 0) {
  const now = new Date();
  const start = new Date(now.getTime() - lookbackMinutes * 60_000);
  const end = new Date(now.getTime() + lookaheadMinutes * 60_000);
  return fetchEventsInRange(start, end);
}
