import { workspaceFetch as fetch } from '@/lib/workspace-fetch';
import { wrapPrintText } from '@/lib/print-layout';
import type { PracticeGameplanSource } from '@/lib/practice-generation';

export type PracticePlanRecord = {
  version: string;
  id: string;
  gameId: string | null;
  title: string;
  practiceDate: string;
  durationMinutes: number;
  blocks: string[][];
  generated: boolean;
  gameplanSource?: PracticeGameplanSource | null;
};
export type PracticePrintOptions = {
  paper: 'letter' | 'a4';
  landscape: boolean;
  notes: boolean;
};
const validDate = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T12:00:00Z')) &&
  new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
const timeMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};
export function practicePrintRecord(value: unknown): PracticePlanRecord {
  const plan = value as PracticePlanRecord | null;
  if (
    !plan ||
    typeof plan.id !== 'string' ||
    !plan.id ||
    typeof plan.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(plan.version) ||
    typeof plan.title !== 'string' ||
    !plan.title.trim() ||
    plan.title.length > 120 ||
    !validDate(plan.practiceDate) ||
    typeof plan.generated !== 'boolean' ||
    !Array.isArray(plan.blocks) ||
    plan.blocks.length > 200 ||
    plan.blocks.some(
      (block) =>
        !Array.isArray(block) ||
        block.length !== 5 ||
        block.some((part) => typeof part !== 'string' || part.length > 4000) ||
        !block[2].trim() ||
        !(
          block[0] === 'TBD' || /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(block[0])
        ) ||
        !/^\d{1,3} min$/.test(block[1]) ||
        parseInt(block[1], 10) < 1 ||
        parseInt(block[1], 10) > 600,
    ) ||
    plan.durationMinutes !==
      plan.blocks.reduce((sum, block) => sum + parseInt(block[1], 10), 0)
  )
    throw new Error(
      'This saved practice is incomplete. Reload it before preparing a printout.',
    );
  const source = plan.gameplanSource;
  if (
    source &&
    (typeof source.id !== 'string' ||
      !source.id ||
      typeof source.title !== 'string' ||
      !source.title ||
      source.title.length > 120 ||
      typeof source.version !== 'string' ||
      !/^[a-f0-9]{64}$/.test(source.version))
  )
    throw new Error(
      'The saved practice source could not be read. Reload before printing.',
    );
  return structuredClone(plan);
}
export async function readPracticePrintSnapshot(
  plan: PracticePlanRecord,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher('/api/practice-plans', { cache: 'no-store' });
  const data = (await response.json()) as {
    plans?: unknown[];
    error?: string;
  } | null;
  if (!response.ok || !Array.isArray(data?.plans))
    throw new Error(
      data?.error ||
        'The saved practice could not be checked. Retry before printing.',
    );
  const matches = data.plans.filter(
    (row) => row && (row as { id?: unknown }).id === plan.id,
  );
  if (matches.length !== 1)
    throw new Error(
      'This practice is unavailable. Reload the saved list before printing.',
    );
  const saved = practicePrintRecord(matches[0]);
  if (saved.version !== plan.version)
    throw new Error(
      'This practice changed on another device. Reload and review the saved plan before printing.',
    );
  return saved;
}
export async function readPracticePrintPlans(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher('/api/practice-plans', {
    cache: 'no-store',
    signal,
  });
  const data = (await response.json()) as {
    plans?: unknown[];
    error?: string;
  } | null;
  if (!response.ok || !Array.isArray(data?.plans))
    throw new Error(
      data?.error ||
        'Saved practices could not be loaded. Retry before printing.',
    );
  const plans = data.plans.map(practicePrintRecord);
  if (new Set(plans.map((plan) => plan.id)).size !== plans.length)
    throw new Error(
      'The saved practice list was incomplete. Retry before printing.',
    );
  return plans;
}
const groupLabels = new Map([
  ['offence', 'Offence'],
  ['defence', 'Defence'],
  ['teams', 'Special teams'],
  ['team', 'Team'],
]);
export const practiceGroupLabel = (value: string) =>
  groupLabels.get(value) ?? value;
export function practiceTimesOutOfOrder(blocks: string[][]) {
  const timed = blocks.filter((block) => block[0] !== 'TBD');
  return timed.some(
    (block, index) =>
      index > 0 && timeMinutes(block[0]) < timeMinutes(timed[index - 1][0]),
  );
}
export function practicePrintDate(value: string) {
  if (!validDate(value)) throw new Error('Choose a valid saved practice date.');
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(value + 'T12:00:00Z'));
}
type PrintLine = {
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  muted: boolean;
};
export type PracticePrintPage = { lines: PrintLine[]; rules: number[] };
export function layoutPracticePrint(
  planValue: PracticePlanRecord,
  teamName: string,
  options: PracticePrintOptions,
  measure: (text: string, size: number, bold: boolean) => number,
) {
  const plan = practicePrintRecord(planValue);
  if (!plan.blocks.length)
    throw new Error(
      'Add and save a practice segment before preparing a printout.',
    );
  if (
    !['letter', 'a4'].includes(options.paper) ||
    typeof options.landscape !== 'boolean' ||
    typeof options.notes !== 'boolean'
  )
    throw new Error('Choose valid print options.');
  if (typeof teamName !== 'string' || teamName.length > 200)
    throw new Error('The team name could not be prepared.');
  const size = options.paper === 'a4' ? [595.28, 841.89] : [612, 792];
  const [width, height] = options.landscape ? [size[1], size[0]] : size;
  const margin = 36,
    bottom = height - 45,
    contentWidth = width - margin * 2;
  const pages: PracticePrintPage[] = [];
  let page: PracticePrintPage,
    y = 0,
    segment = '';
  const line = (text: string, size: number, bold: boolean, muted = false) => {
    page.lines.push({ text, x: margin, y, size, bold, muted });
    y += size * 1.45;
  };
  const headerText = (
    text: string,
    size: number,
    bold: boolean,
    muted = false,
  ) => {
    for (const part of wrapPrintText(text, contentWidth, (value) =>
      measure(value, size, bold),
    ))
      line(part, size, bold, muted);
  };
  const newPage = (continued = false) => {
    if (pages.length >= 100)
      throw new Error(
        'This practice exceeds 100 printable pages. Shorten coaching notes or turn them off in print options.',
      );
    page = { lines: [], rules: [] };
    pages.push(page);
    y = 32;
    headerText(teamName || 'ChalkTalk', 10, true, true);
    y += 5;
    headerText(
      plan.title + (continued ? ' (continued)' : ''),
      continued ? 17 : 21,
      true,
    );
    y += 5;
    headerText(
      `${practicePrintDate(plan.practiceDate)}  |  ${plan.durationMinutes} segment minutes  |  ${plan.blocks.length} segments`,
      10,
      false,
      true,
    );
    if (!continued && plan.gameplanSource)
      headerText(
        `Source gameplan: ${plan.gameplanSource.title} (recorded at generation)`,
        10,
        false,
        true,
      );
    if (y > bottom / 2)
      throw new Error(
        'The print header is too long. Shorten the team or practice name.',
      );
    y += 7;
    page.rules.push(y);
    y += 20;
    if (continued && segment) {
      headerText(segment + ' - continued', 11, true);
      y += 5;
    }
  };
  const text = (value: string, size = 11, bold = false, muted = false) => {
    for (const part of wrapPrintText(value, contentWidth, (value) =>
      measure(value, size, bold),
    )) {
      if (y + size * 1.45 > bottom) newPage(true);
      line(part, size, bold, muted);
    }
  };
  newPage();
  text(
    'Times are entered start times. Total minutes sum the segments; gaps are not included.',
    9,
    false,
    true,
  );
  y += 8;
  if (practiceTimesOutOfOrder(plan.blocks)) {
    text(
      'Review timing: segment order differs from entered start times.',
      10,
      true,
    );
    y += 8;
  }
  for (const [index, block] of plan.blocks.entries()) {
    segment = `Segment ${index + 1}`;
    if (y + 65 > bottom) newPage();
    text(`${index + 1}. ${block[2]}`, 13, true);
    y += 3;
    text(
      `Start: ${block[0] === 'TBD' ? 'Not scheduled' : block[0]}  |  ${block[1]}  |  ${practiceGroupLabel(block[4]) || 'Team'}`,
      10,
      false,
      true,
    );
    y += 6;
    if (options.notes && block[3]) text(block[3]);
    y += 10;
    if (y < bottom - 8) {
      page!.rules.push(y);
      y += 18;
    }
  }
  return { pages, width, height };
}
