export type Side = 'Offence' | 'Defence' | 'Special teams';
export type Point = { x: number; y: number };
export type Player = Point & {
  id: string;
  label: string;
  kind: 'line' | 'skill' | 'qb' | 'back';
  colour?: string;
  symbol?: 'circle' | 'triangle' | 'square';
  opponent?: boolean;
};
export type Route = {
  id: string;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  colour: string;
  lineStyle: 'solid' | 'dashed' | 'dotted' | 'curve';
  playerId?: string;
  points?: Point[];
  ending?: 'arrow' | 'bar' | 'none';
};
export type Zone = Point & {
  routeId?: string;
  id: string;
  width: number;
  height: number;
  colour: string;
  shape?: 'ellipse' | 'rectangle' | 'triangle';
  opacity?: number;
  rotation?: number;
};
export type Label = Point & { id: string; text: string; colour: string };
export type Assignment = {
  id: string;
  position: string;
  title: string;
  detail: string;
};
export type Drawing = {
  diagramVersion?: number;
  fieldPosition?: number;
  players?: Player[];
  routes?: Route[];
  zones?: Zone[];
  labels?: Label[];
  showOpponent?: boolean;
  opponentFormationId?: string | null;
  opponentPlayers?: Player[];
};
export type DesignerPlay = Drawing & {
  id: string;
  name: string;
  unit?: string;
  playbookId?: string;
  formationId?: string | null;
  formation: string;
  category: string;
  family:
    | 'Unassigned'
    | 'Run'
    | 'Pass'
    | 'RPO'
    | 'Screen'
    | 'Coverage'
    | 'Pressure'
    | 'Run fit'
    | 'Kickoff'
    | 'Kick return'
    | 'Punt'
    | 'Punt return'
    | 'Field goal';
  concept: string;
  variant: number;
  notes?: string;
  assignments?: Assignment[];
  locked?: boolean;
};
export type Formation = Drawing & {
  id: string;
  name: string;
  unit: Side;
  personnel: string;
  scope: 'team' | 'scout';
  opponent: string;
  packageName: string;
  count: number;
};
export type Book = {
  id: string;
  name: string;
  side: string;
  archived: boolean;
  plays: number;
  formations: number;
  updated: string;
};
export type Library = {
  books: Book[];
  plays: DesignerPlay[];
  formations: Formation[];
  createdId?: string;
};
export type Scene = {
  diagramVersion: 2;
  fieldPosition: number;
  players: Player[];
  routes: Route[];
  zones: Zone[];
  labels: Label[];
  showOpponent: boolean;
  opponentFormationId: string | null;
  opponentPlayers: Player[];
};
export const YARD = 10;
export const FIELD_X = 35;
export const FIELD_WIDTH = 650;
export const yardY = (spot: number) => 100 + spot * YARD;
export const snapY = (y: number) => 100 + Math.round((y - 100) / YARD) * YARD;
export const snapX = (x: number) =>
  FIELD_X + Math.round((x - FIELD_X) / YARD) * YARD;
export const spotLabel = (spot: number) =>
  spot === 55 ? 'C' : spot < 55 ? `Own ${spot}` : `Opp ${110 - spot}`;

export function startingPlayers(side: string, spot = 55): Player[] {
  const los = yardY(spot);
  const make = (
    label: string,
    x: number,
    depth: number,
    kind: Player['kind'] = 'skill',
  ): Player => ({
    id: crypto.randomUUID(),
    label,
    x,
    y: los + depth * YARD,
    kind,
    colour:
      side === 'Defence'
        ? kind === 'line'
          ? '#e5e9ef'
          : ['S', 'MA', 'MI', 'W'].includes(label)
            ? '#ef665c'
            : '#52c5b5'
        : '#e5e9ef',
    symbol:
      side === 'Defence' ? 'triangle' : kind === 'line' ? 'square' : 'circle',
  });
  if (side === 'Defence')
    return [
      make('FE', 285, -1, 'line'),
      make('N', 355, -1, 'line'),
      make('BE', 425, -1, 'line'),
      make('S', 255, -5),
      make('MA', 325, -5),
      make('MI', 395, -5),
      make('W', 465, -5),
      make('FC', 105, -8),
      make('FH', 195, -8),
      make('BH', 535, -8),
      make('BC', 625, -8),
      make('FS', 365, -15),
    ];
  if (side === 'Special teams')
    return [
      make('LS', 355, 1, 'line'),
      ...[235, 275, 315, 395, 435, 475].map((x, index) =>
        make(`P${index + 1}`, x, 1, 'line'),
      ),
      make('L', 105, 1),
      make('R', 625, 1),
      make('UP', 355, 6),
      make('H', 355, 10),
      make('K', 355, 15),
    ];
  return [
    ...['LT', 'LG', 'C', 'RG', 'RT'].map((label, index) =>
      make(label, 295 + index * 30, 1, 'line'),
    ),
    make('X', 95, 1),
    make('A', 195, 2),
    make('Y', 515, 1),
    make('Z', 625, 1),
    make('B', 565, 3),
    make('Q', 355, 5, 'qb'),
    make('R', 385, 9, 'back'),
  ];
}

export function normalizeDrawing(drawing: Drawing): Scene {
  const modern = drawing.diagramVersion === 2;
  const y = (value: number) =>
    modern ? value : 100 + ((value - 45) / (510 / 110)) * YARD;
  const point = (p: Point) => ({ x: p.x, y: y(p.y) });
  return {
    diagramVersion: 2,
    fieldPosition: drawing.fieldPosition ?? 55,
    players: (drawing.players ?? []).map((p) => ({ ...p, ...point(p) })),
    routes: (drawing.routes ?? []).map((r) => ({
      ...r,
      startY: y(r.startY),
      endY: y(r.endY),
      points: (r.points?.length
        ? r.points
        : [
            { x: r.startX, y: r.startY },
            { x: r.endX, y: r.endY },
          ]
      ).map(point),
    })),
    zones: (drawing.zones ?? []).map((z) => ({
      ...z,
      ...point(z),
      ...(z.routeId && drawing.routes?.find((r) => r.id === z.routeId)
        ? (() => {
            const r = drawing.routes!.find((r) => r.id === z.routeId)!;
            const end = r.points?.at(-1) ?? { x: r.endX, y: r.endY };
            return {
              x: end.x - z.width / 2,
              y:
                y(end.y) -
                (modern ? z.height : (z.height * YARD) / (510 / 110)) / 2,
            };
          })()
        : {}),
      height: modern ? z.height : (z.height * YARD) / (510 / 110),
      shape: z.shape ?? 'ellipse',
    })),
    labels: (drawing.labels ?? []).map((l) => ({ ...l, ...point(l) })),
    showOpponent: Boolean(drawing.showOpponent),
    opponentFormationId: drawing.opponentFormationId ?? null,
    opponentPlayers: (drawing.opponentPlayers ?? []).map((p) => ({
      ...p,
      ...point(p),
      opponent: true,
    })),
  };
}

export function shiftScene(scene: Scene, spot: number): Scene {
  const delta = (spot - scene.fieldPosition) * YARD;
  const shift = <T extends Point>(p: T): T => ({ ...p, y: p.y + delta });
  return {
    ...scene,
    fieldPosition: spot,
    players: scene.players.map(shift),
    opponentPlayers: scene.opponentPlayers.map(shift),
    zones: scene.zones.map(shift),
    labels: scene.labels.map(shift),
    routes: scene.routes.map((r) => ({
      ...r,
      startY: r.startY + delta,
      endY: r.endY + delta,
      points: r.points?.map(shift),
    })),
  };
}

export function formationPlayers(
  formation: Formation,
  spot: number,
  opponent = false,
): Player[] {
  const scene = normalizeDrawing(formation);
  const shifted = shiftScene(scene, spot);
  return shifted.players.map((p) => ({
    ...p,
    id: `${opponent ? 'opp-' : ''}${p.id}`,
    opponent,
  }));
}

export function routePath(route: Route): string {
  const points = route.points?.length
    ? route.points
    : [
        { x: route.startX, y: route.startY },
        { x: route.endX, y: route.endY },
      ];
  if (route.lineStyle !== 'curve' || points.length < 3)
    return `M${points.map((p) => `${p.x} ${p.y}`).join(' L')}`;
  let result = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i],
      next = points[i + 1];
    result += ` Q${p.x} ${p.y} ${(p.x + next.x) / 2} ${(p.y + next.y) / 2}`;
  }
  const end = points.at(-1)!;
  return `${result} T${end.x} ${end.y}`;
}
