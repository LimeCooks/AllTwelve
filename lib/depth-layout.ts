export type DepthUnit = 'Offence' | 'Defence' | 'Special teams';
export type DepthSlot = {
  id: string;
  pos: string;
  athleteId: string;
  x: number;
  y: number;
  notes: string;
};
export type DepthLayouts = Record<DepthUnit, DepthSlot[]>;
export const depthUnits: DepthUnit[] = ['Offence', 'Defence', 'Special teams'];
export const emptyDepthLayouts = (): DepthLayouts => ({
  Offence: [],
  Defence: [],
  'Special teams': [],
});

export function parseDepthLayouts(value: unknown): DepthLayouts {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('The saved alignment is invalid.');
  const source = value as Record<string, unknown>,
    result = emptyDepthLayouts();
  for (const unit of depthUnits) {
    const rows = source[unit];
    if (!Array.isArray(rows) || rows.length > 200)
      throw new Error('Use up to 200 positions per unit.');
    const ids = new Set<string>();
    result[unit] = rows.map((row: unknown) => {
      if (!row || typeof row !== 'object' || Array.isArray(row))
        throw new Error('A position is invalid.');
      const slot = row as Record<string, unknown>;
      if (
        typeof slot.id !== 'string' ||
        !slot.id ||
        slot.id.length > 100 ||
        ids.has(slot.id)
      )
        throw new Error('Each position needs its own ID.');
      ids.add(slot.id);
      if (
        typeof slot.pos !== 'string' ||
        !slot.pos.trim() ||
        slot.pos.trim().length > 100
      )
        throw new Error('Enter a position name of up to 100 characters.');
      if (typeof slot.athleteId !== 'string')
        throw new Error('Choose a valid athlete or leave the role unassigned.');
      if (
        typeof slot.x !== 'number' ||
        !Number.isFinite(slot.x) ||
        slot.x < 0 ||
        slot.x > 100 ||
        typeof slot.y !== 'number' ||
        !Number.isFinite(slot.y) ||
        slot.y < 0 ||
        slot.y > 100
      )
        throw new Error('Position coordinates must be between 0 and 100.');
      if (
        slot.notes !== undefined &&
        (typeof slot.notes !== 'string' || slot.notes.length > 10000)
      )
        throw new Error('Use up to 10,000 characters for a role note.');
      return {
        id: slot.id,
        pos: slot.pos.trim(),
        athleteId: slot.athleteId,
        x: slot.x,
        y: slot.y,
        notes: typeof slot.notes === 'string' ? slot.notes : '',
      };
    });
  }
  return result;
}
