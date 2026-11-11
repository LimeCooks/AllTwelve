type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Diagram items must be objects.');
  return value as RecordValue;
};
const coordinate = (
  value: unknown,
  label: string,
  maximum = 720,
  minimum = 0,
) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  )
    throw new Error(`Invalid ${label} in diagram.`);
};

export function validatePlayDiagram(body: RecordValue) {
  const arrays = [
    'players',
    'opponentPlayers',
    'routes',
    'zones',
    'labels',
    'assignments',
  ];
  const maxY = body.diagramVersion === 2 ? 3000 : 600;
  const minY = body.diagramVersion === 2 ? -1500 : 0;
  for (const key of arrays) {
    const items = body[key] ?? [];
    if (!Array.isArray(items) || items.length > 200)
      throw new Error(`Invalid ${key}: expected up to 200 items.`);
    const ids = new Set<string>();
    for (const input of items) {
      const item = record(input);
      if (
        typeof item.id !== 'string' ||
        !item.id ||
        item.id.length > 100 ||
        ids.has(item.id)
      )
        throw new Error(`Each ${key} item needs a unique ID.`);
      ids.add(item.id);
      if (key === 'assignments') {
        if (
          typeof item.position !== 'string' ||
          !item.position.trim() ||
          typeof item.title !== 'string' ||
          !item.title.trim()
        )
          throw new Error('Every assignment needs a position and title.');
        continue;
      }
      if (
        item.colour !== undefined &&
        (typeof item.colour !== 'string' || !/^#[a-f\d]{6}$/i.test(item.colour))
      )
        throw new Error('Choose a valid drawing colour.');
      if (key === 'routes') {
        for (const name of ['startX', 'endX']) coordinate(item[name], name);
        for (const name of ['startY', 'endY'])
          coordinate(item[name], name, maxY, minY);
        if (
          !['solid', 'dashed', 'dotted', 'curve'].includes(
            String(item.lineStyle),
          )
        )
          throw new Error('Choose a valid route line style.');
        if (item.points !== undefined) {
          if (
            !Array.isArray(item.points) ||
            item.points.length < 2 ||
            item.points.length > 100
          )
            throw new Error('Routes need 2–100 points.');
          for (const point of item.points) {
            const value = record(point);
            coordinate(value.x, 'route x');
            coordinate(value.y, 'route y', maxY, minY);
          }
        }
      } else {
        coordinate(item.x, 'x');
        coordinate(item.y, 'y', maxY, minY);
        if (key === 'zones') {
          coordinate(item.width, 'zone width');
          coordinate(item.height, 'zone height', 600);
          if (Number(item.width) <= 0 || Number(item.height) <= 0)
            throw new Error('Coverage shapes need positive width and depth.');
          if (
            item.shape !== undefined &&
            (typeof item.shape !== 'string' ||
              !['ellipse', 'rectangle', 'triangle'].includes(item.shape))
          )
            throw new Error('Choose a valid coverage shape.');
          if (
            item.opacity !== undefined &&
            (typeof item.opacity !== 'number' ||
              !Number.isFinite(item.opacity) ||
              item.opacity < 0.1 ||
              item.opacity > 0.8)
          )
            throw new Error('Coverage opacity must be between 10% and 80%.');
          if (
            item.rotation !== undefined &&
            (typeof item.rotation !== 'number' ||
              !Number.isFinite(item.rotation) ||
              item.rotation < -180 ||
              item.rotation > 180)
          )
            throw new Error('Rotation must be between -180 and 180 degrees.');
        }
        if (
          (key === 'players' || key === 'opponentPlayers') &&
          !['line', 'skill', 'qb', 'back'].includes(String(item.kind))
        )
          throw new Error('Choose a valid player symbol.');
        if (
          (key === 'players' || key === 'opponentPlayers') &&
          (typeof item.label !== 'string' || item.label.length > 12)
        )
          throw new Error('Player labels must be text of up to 12 characters.');
        if (
          key === 'labels' &&
          (typeof item.text !== 'string' || item.text.length > 200)
        )
          throw new Error('Diagram labels must contain up to 200 characters.');
      }
    }
  }
  if (
    body.fieldPosition !== undefined &&
    (typeof body.fieldPosition !== 'number' ||
      !Number.isFinite(body.fieldPosition) ||
      body.fieldPosition < 0 ||
      body.fieldPosition > 110)
  )
    throw new Error('Ball position must be between 0 and 110 yards.');
  if (body.diagramVersion === 2) {
    const players = [
      ...((body.players ?? []) as RecordValue[]),
      ...((body.opponentPlayers ?? []) as RecordValue[]),
    ];
    const playerIds = new Set(players.map((player) => player.id));
    if (playerIds.size !== players.length)
      throw new Error('Our players and opponents need distinct IDs.');
    const routes = (body.routes ?? []) as RecordValue[];
    const routeIds = new Set(routes.map((route) => route.id));
    if (
      routes.some(
        (route) =>
          route.playerId !== undefined &&
          (typeof route.playerId !== 'string' ||
            !playerIds.has(route.playerId)),
      )
    )
      throw new Error(
        'A route refers to a player that is not in this drawing.',
      );
    if (
      ((body.zones ?? []) as RecordValue[]).some(
        (zone) =>
          zone.routeId !== undefined &&
          (typeof zone.routeId !== 'string' || !routeIds.has(zone.routeId)),
      )
    )
      throw new Error(
        'A coverage shape refers to a route that is not in this drawing.',
      );
  }
}
