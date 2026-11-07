import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/calendar-layout.ts', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
function run(body) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {calendarSegments,eventsInCalendarPeriod} from ${JSON.stringify(moduleUrl)};
    const event=(id,start,end)=>({id,title:id,startsAt:start,endsAt:end,eventType:'practice',location:'Field',notes:''});
    ${body}`,
      ],
      { encoding: 'utf8', env: { ...process.env, TZ: 'America/Halifax' } },
    ),
  );
}

test('overnight events continue into visible days and an exclusive midnight end creates no phantom segment', () => {
  const result =
    run(`const events=[event('incoming','2026-11-01T23:30:00-04:00','2026-11-02T01:15:00-04:00'),event('midnight','2026-11-02T23:30:00-04:00','2026-11-03T00:00:00-04:00'),event('long','2026-10-31T12:00:00-03:00','2026-11-05T10:00:00-04:00')];
    const before=JSON.stringify(events);
    const result=calendarSegments(events,['2026-11-02','2026-11-03']);
    console.log(JSON.stringify({unchanged:before===JSON.stringify(events),segments:result}));`);
  assert.equal(result.unchanged, true);
  const incoming = result.segments.find((s) => s.event.id === 'incoming');
  assert.equal(incoming.day, 0);
  assert.equal(incoming.startMinute, 0);
  assert.equal(incoming.endMinute, 75);
  assert.equal(incoming.continuesBefore, true);
  assert.equal(incoming.continuesAfter, false);
  const midnight = result.segments.filter((s) => s.event.id === 'midnight');
  assert.equal(midnight.length, 1);
  assert.equal(midnight[0].endMinute, 1440);
  const long = result.segments.filter((s) => s.event.id === 'long');
  assert.equal(long.length, 2);
  assert.ok(
    long.every(
      (s) =>
        s.startMinute === 0 &&
        s.endMinute === 1440 &&
        s.continuesBefore &&
        s.continuesAfter,
    ),
  );
});

test('minute placement and transitive overlap lanes retain access to every event, with no collision in the same lane', () => {
  const segments =
    run(`const events=[event('a','2026-11-07T09:00:00-04:00','2026-11-07T10:00:00-04:00'),event('b','2026-11-07T09:30:00-04:00','2026-11-07T11:00:00-04:00'),event('c','2026-11-07T10:00:00-04:00','2026-11-07T10:30:00-04:00'),event('d','2026-11-07T12:15:00-04:00','2026-11-07T12:20:00-04:00'),event('e','2026-11-07T12:20:00-04:00','2026-11-07T12:25:00-04:00'),event('late','2026-11-07T23:55:00-04:00','2026-11-08T00:00:00-04:00')];
    console.log(JSON.stringify(calendarSegments(events,['2026-11-07'])));`);
  assert.equal(segments.length, 6);
  const a = segments.find((s) => s.event.id === 'a'),
    b = segments.find((s) => s.event.id === 'b'),
    c = segments.find((s) => s.event.id === 'c');
  assert.equal(b.startMinute, 570);
  assert.equal(b.endMinute, 660);
  assert.equal(a.columns, 2);
  assert.equal(b.columns, 2);
  assert.equal(c.columns, 2);
  assert.equal(a.column, c.column);
  assert.notEqual(a.column, b.column);
  for (const s of segments) {
    assert.ok(
      s.startMinute >= 0 && s.endMinute <= 1440 && s.endMinute > s.startMinute,
    );
    assert.ok(s.column >= 0 && s.column < s.columns);
  }
  for (const [i, s] of segments.entries())
    for (const other of segments.slice(i + 1)) {
      if (s.startMinute < other.endMinute && other.startMinute < s.endMinute)
        assert.notEqual(s.column, other.column);
    }
  assert.equal(segments.find((s) => s.event.id === 'late').columns, 1);
});

test('calendar-day splitting respects DST midnights and month carry-over without rewriting instants', () => {
  const result =
    run(`const spring=calendarSegments([event('spring','2026-03-08T00:00:00-04:00','2026-03-09T00:00:00-03:00')],['2026-03-08','2026-03-09']);
    const repeated=calendarSegments([event('repeat','2026-11-01T01:45:00-03:00','2026-11-01T01:15:00-04:00')],['2026-11-01']);
    const month=eventsInCalendarPeriod([event('carry','2026-10-31T23:00:00-03:00','2026-11-01T01:00:00-03:00'),event('outside','2026-10-31T22:00:00-03:00','2026-11-01T00:00:00-03:00')],new Date('2026-11-01T00:00:00'),new Date('2026-12-01T00:00:00'));
    console.log(JSON.stringify({spring,repeated,month}));`);
  assert.equal(result.spring.length, 1);
  assert.equal(result.spring[0].startMinute, 0);
  assert.equal(result.spring[0].endMinute, 1440);
  assert.equal(result.repeated.length, 1);
  assert.ok(result.repeated[0].endMinute > result.repeated[0].startMinute);
  assert.equal(result.repeated[0].event.endsAt, '2026-11-01T01:15:00-04:00');
  assert.deepEqual(
    result.month.map((e) => e.id),
    ['carry'],
  );
});
