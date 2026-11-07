import type { CalendarEventRecord } from '@/types/domain';

export function calendarDate(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function localEventTime(date: string, time: string) {
  const value = new Date(`${date}T${time}:00`);
  if (
    Number.isNaN(value.getTime()) ||
    calendarDate(value.toISOString()) !== date ||
    value.getHours() !== Number(time.slice(0, 2)) ||
    value.getMinutes() !== Number(time.slice(3, 5))
  )
    throw new Error(
      'Choose a valid local date and time. This time may be skipped by a daylight-saving change.',
    );
  return value.toISOString();
}

export function calendarClock(iso: string) {
  const date = new Date(iso);
  return {
    hour: date.getHours(),
    minute: date.getMinutes(),
    label: date.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }),
  };
}

export function calendarExport(
  events: CalendarEventRecord[],
  now = new Date(),
) {
  const utc = (iso: string) =>
    new Date(iso)
      .toISOString()
      .replaceAll('-', '')
      .replaceAll(':', '')
      .replace(/\.\d{3}/, '');
  const escape = (text: string) =>
    text
      .replaceAll('\\', '\\\\')
      .replaceAll(';', '\\;')
      .replaceAll(',', '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  const fold = (line: string) => {
    const encoder = new TextEncoder();
    let output = '',
      bytes = 0;
    for (const character of line) {
      const length = encoder.encode(character).length;
      if (bytes + length > 75) {
        output += '\r\n ';
        bytes = 1;
      }
      output += character;
      bytes += length;
    }
    return output;
  };
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ChalkTalk//Team Calendar//EN',
    'CALSCALE:GREGORIAN',
    ...events.flatMap((event) => [
      'BEGIN:VEVENT',
      `UID:${escape(event.id)}@chalktalk`,
      `DTSTAMP:${utc(now.toISOString())}`,
      `DTSTART:${utc(event.startsAt)}`,
      `DTEND:${utc(event.endsAt)}`,
      `SUMMARY:${escape(event.title)}`,
      `LOCATION:${escape(event.location)}`,
      `DESCRIPTION:${escape(event.notes)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
    '',
  ]
    .map(fold)
    .join('\r\n');
}
