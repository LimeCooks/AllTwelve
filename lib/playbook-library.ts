import { validatePlayDiagram } from '@/lib/validate-play';
import type { Library } from '@/lib/play-designer';
export function parsePlaybookLibrary(value: unknown): Library {
  const data = value as Library | null;
  const sides = ['Offence', 'Defence', 'Special teams'];
  const unique = (records: { id: string }[]) =>
    records.every(
      (record) => record && typeof record.id === 'string' && Boolean(record.id),
    ) && new Set(records.map((record) => record.id)).size === records.length;
  if (
    !data ||
    !Array.isArray(data.books) ||
    !Array.isArray(data.plays) ||
    !Array.isArray(data.formations) ||
    !unique(data.books) ||
    !unique(data.plays) ||
    !unique(data.formations)
  )
    throw new Error('The saved library was incomplete. Please retry.');
  if (
    !data.books.every(
      (book) =>
        typeof book.name === 'string' &&
        sides.includes(book.side) &&
        typeof book.archived === 'boolean' &&
        Number.isInteger(book.plays) &&
        book.plays >= 0 &&
        Number.isInteger(book.formations) &&
        book.formations >= 0 &&
        typeof book.updated === 'string',
    )
  )
    throw new Error('Saved playbook details could not be read. Please retry.');
  for (const play of data.plays) {
    if (
      typeof play.name !== 'string' ||
      typeof play.formation !== 'string' ||
      typeof play.concept !== 'string' ||
      typeof play.family !== 'string' ||
      !sides.includes(play.unit ?? '') ||
      (play.notes !== undefined && typeof play.notes !== 'string') ||
      (play.playbookId &&
        !data.books.some((book) => book.id === play.playbookId))
    )
      throw new Error('Saved play details could not be read. Please retry.');
    validatePlayDiagram(play as unknown as Record<string, unknown>);
  }
  for (const formation of data.formations) {
    if (
      typeof formation.name !== 'string' ||
      !sides.includes(formation.unit) ||
      !['team', 'scout'].includes(formation.scope) ||
      ![formation.personnel, formation.opponent, formation.packageName].every(
        (value) => typeof value === 'string',
      )
    )
      throw new Error(
        'Saved formation details could not be read. Please retry.',
      );
    validatePlayDiagram(formation as unknown as Record<string, unknown>);
  }
  if (
    data.createdId !== undefined &&
    (typeof data.createdId !== 'string' ||
      ![...data.books, ...data.plays, ...data.formations].some(
        (record) => record.id === data.createdId,
      ))
  )
    throw new Error(
      'The created record could not be confirmed. Your draft is preserved.',
    );
  return data;
}
