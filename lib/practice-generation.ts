import { resolveGameplanPlay, type GameplanState } from '@/lib/gameplan-state';
export type PracticeGameplanSource = {
  id: string;
  title: string;
  version: string;
};
export function practiceFromGameplan(
  state: GameplanState,
  plays: { id: string; name: string; unit?: string }[],
) {
  const group =
    state.unit === 'Special teams' ? 'teams' : state.unit.toLowerCase();
  for (const reference of state.callBuckets.flatMap((bucket) => bucket.plays)) {
    const play = resolveGameplanPlay(reference, plays);
    if (!play || (play.unit && play.unit !== state.unit))
      throw new Error(
        'A gameplan play is unavailable, ambiguous, or belongs to another unit. Repair the call sheet before generating practice.',
      );
  }
  const blocks = [
    ...state.objectives.map((objective) => [
      'TBD',
      '10 min',
      objective.title,
      objective.detail,
      group,
    ]),
    ...state.callBuckets
      .filter((bucket) => bucket.plays.length)
      .map((bucket) => [
        'TBD',
        '15 min',
        bucket.name,
        bucket.plays
          .map((reference) => resolveGameplanPlay(reference, plays)!.name)
          .join('; '),
        group,
      ]),
  ];
  if (!blocks.length)
    throw new Error(
      'Add objectives or saved plays to this gameplan before generating practice.',
    );
  return blocks;
}
