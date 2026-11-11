import type { CalendarEventRecord } from '@/types/domain';

export type CalendarSegment = {
  event: CalendarEventRecord;
  day: number;
  date: string;
  startMinute: number;
  endMinute: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  column: number;
  columns: number;
};

function minute(value: number) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

export function eventsInCalendarPeriod(
  events: CalendarEventRecord[],
  start: Date,
  end: Date,
) {
  return events.filter(
    (event) =>
      Date.parse(event.startsAt) < end.getTime() &&
      Date.parse(event.endsAt) > start.getTime(),
  );
}

// Only split the visible days. A years-long event must not create an unbounded
// list, and local midnights must advance by calendar day rather than 24 hours.
export function calendarSegments(
  events: CalendarEventRecord[],
  dates: string[],
): CalendarSegment[] {
  return dates.flatMap((date, day) => {
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const segments = eventsInCalendarPeriod(events, start, end)
      .map((event): CalendarSegment => {
        const eventStart = Date.parse(event.startsAt),
          eventEnd = Date.parse(event.endsAt);
        const clippedStart = Math.max(eventStart, start.getTime());
        const clippedEnd = Math.min(eventEnd, end.getTime());
        const rawStart =
          clippedStart === start.getTime() ? 0 : minute(clippedStart);
        const rawEnd = clippedEnd === end.getTime() ? 1440 : minute(clippedEnd);
        // A minimum half-hour visual footprint keeps short events readable. Also
        // keep an event crossing a repeated DST hour visible when its end clock
        // precedes its start clock. The detail dialog retains the exact instants.
        const startMinute = Math.min(rawStart, 1410);
        const endMinute = Math.min(1440, Math.max(rawEnd, startMinute + 30));
        return {
          event,
          day,
          date,
          startMinute,
          endMinute,
          continuesBefore: eventStart < start.getTime(),
          continuesAfter: eventEnd > end.getTime(),
          column: 0,
          columns: 1,
        };
      })
      .sort(
        (a, b) =>
          a.startMinute - b.startMinute ||
          b.endMinute - a.endMinute ||
          a.event.id.localeCompare(b.event.id),
      );

    let group: CalendarSegment[] = [],
      groupEnd = -1;
    const finish = () => {
      const columnEnds: number[] = [];
      for (const segment of group) {
        let column = columnEnds.findIndex(
          (endsAt) => endsAt <= segment.startMinute,
        );
        if (column === -1) column = columnEnds.length;
        segment.column = column;
        columnEnds[column] = segment.endMinute;
      }
      for (const segment of group) segment.columns = columnEnds.length;
    };
    for (const segment of segments) {
      if (segment.startMinute >= groupEnd) {
        finish();
        group = [];
        groupEnd = -1;
      }
      group.push(segment);
      groupEnd = Math.max(groupEnd, segment.endMinute);
    }
    finish();
    return segments;
  });
}
