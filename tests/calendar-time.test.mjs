import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import ts from 'typescript';
const source = await readFile(
  new URL('../lib/calendar-time.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const url = `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`;
const { calendarExport } = await import(url);

test('local event times respect Atlantic winter/summer offsets and reject skipped daylight-saving times', () => {
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {localEventTime, calendarDate} from ${JSON.stringify(url)};
    let skipped = false; try { localEventTime('2026-03-08','02:30'); } catch { skipped = true; }
    console.log(JSON.stringify({winter:localEventTime('2026-11-06','16:00'),summer:localEventTime('2026-08-29','16:00'),day:calendarDate('2026-11-07T01:30:00Z'),skipped}));`,
      ],
      { encoding: 'utf8', env: { ...process.env, TZ: 'America/Halifax' } },
    ),
  );
  assert.deepEqual(result, {
    winter: '2026-11-06T20:00:00.000Z',
    summer: '2026-08-29T19:00:00.000Z',
    day: '2026-11-06',
    skipped: true,
  });
});

test('calendar export preserves instants, escapes user text, and folds Unicode lines safely', () => {
  const title = 'Practice, defence; notes\\ ' + 'é'.repeat(70);
  const exported = calendarExport(
    [
      {
        id: 'event-1',
        title,
        eventType: 'practice',
        startsAt: '2026-11-06T16:00:00-04:00',
        endsAt: '2026-11-06T17:00:00-04:00',
        location: 'Field, north',
        notes: 'Line one\r\nBEGIN:VEVENT',
      },
    ],
    new Date('2026-11-06T12:00:00Z'),
  );
  const unfolded = exported.replaceAll('\r\n ', '');
  assert.ok(
    unfolded.includes('DTSTART:20261106T200000Z\r\nDTEND:20261106T210000Z'),
  );
  assert.ok(unfolded.includes('SUMMARY:Practice\\, defence\\; notes\\\\ '));
  assert.ok(unfolded.includes('DESCRIPTION:Line one\\nBEGIN:VEVENT'));
  assert.equal(
    exported.split('\r\n').filter((line) => line === 'BEGIN:VEVENT').length,
    1,
  );
  assert.ok(
    exported
      .split('\r\n')
      .every((line) => Buffer.byteLength(line, 'utf8') <= 75),
  );
  assert.ok(exported.endsWith('END:VCALENDAR\r\n'));
});
