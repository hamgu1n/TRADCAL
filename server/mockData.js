// Fake appointments for local development/testing before Azure AD access is
// set up. Generates events relative to "now" so the 30/15/5-minute alarms
// actually fire while testing the kiosk display.
//
// "person" is the requester (an attendee); "categories" holds both the
// status (e.g. "Completed") and the assigned technician, identified by a
// category matching a first name on the technician roster in Settings —
// technicians are no longer attendees on the event.
export function generateMockEvents(now = new Date()) {
  const minutesFromNow = (mins) => new Date(now.getTime() + mins * 60_000).toISOString();

  return [
    {
      id: 'mock-1',
      subject: 'Laptop won\'t boot — Rm 204',
      start: minutesFromNow(5),
      end: minutesFromNow(35),
      location: 'Room 204',
      person: 'Rivera, Jamie',
      categories: ['Scheduled', 'Alex'],
    },
    {
      id: 'mock-2',
      subject: 'Lab PC re-image — Lab 3',
      start: minutesFromNow(15),
      end: minutesFromNow(60),
      location: 'Computer Lab 3',
      person: 'Chen, Amy',
      categories: ['Computer Lab Work', 'Jordan'],
    },
    {
      id: 'mock-3',
      subject: 'Printer setup — Accounting',
      start: minutesFromNow(30),
      end: minutesFromNow(90),
      location: 'Accounting Office',
      person: 'Okafor, Miriam',
      categories: ['Completed', 'Alex'],
    },
    {
      id: 'mock-4',
      subject: 'New hire workstation setup',
      start: minutesFromNow(75),
      end: minutesFromNow(105),
      location: 'IT Help Desk',
      person: 'Rivera, Jamie',
      categories: ['Incomplete', 'Sam'],
    },
    {
      id: 'mock-5',
      subject: 'VPN access troubleshooting',
      start: minutesFromNow(-10),
      end: minutesFromNow(20),
      location: 'Remote',
      person: 'Chen, Amy',
      categories: ['In Progress', 'Jordan'],
    },
    {
      id: 'mock-6',
      subject: 'Projector repair — Rm 118',
      start: minutesFromNow(-90),
      end: minutesFromNow(-30),
      location: 'Room 118',
      person: 'Okafor, Miriam',
      categories: ['Incomplete'],
    },
    {
      id: 'mock-7',
      subject: 'Wi-Fi access point swap',
      start: minutesFromNow(-120),
      end: minutesFromNow(-60),
      location: 'Building B',
      person: 'Rivera, Jamie',
      categories: ['Completed', 'Sam'],
    },
    {
      id: 'mock-8',
      subject: 'Fintel Ref reimage',
      start: minutesFromNow(-40),
      end: minutesFromNow(-20),
      location: 'Fintel',
      person: 'Technician, InfoTech',
      categories: ['Tech Out'],
    },
  ];
}
