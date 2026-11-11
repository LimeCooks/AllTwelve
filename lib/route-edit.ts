import type { Point, Route, Scene } from '@/lib/play-designer';

export function continuationRoute(
  scene: Scene,
  playerId: string,
  preferredId = '',
) {
  const preferred = scene.routes.find(
    (route) => route.id === preferredId && route.playerId === playerId,
  );
  return (
    preferred ??
    scene.routes.filter((route) => route.playerId === playerId).at(-1)
  );
}
export function moveRouteVertex(
  scene: Scene,
  routeId: string,
  index: number,
  point: Point,
): Scene {
  const next = structuredClone(scene),
    route = next.routes.find((route) => route.id === routeId);
  if (!route) return next;
  const points = route.points?.length
    ? route.points
    : [
        { x: route.startX, y: route.startY },
        { x: route.endX, y: route.endY },
      ];
  if (index <= 0 || index >= points.length) return next;
  points[index] = { ...point };
  route.points = points;
  const end = points.at(-1)!;
  route.endX = end.x;
  route.endY = end.y;
  for (const zone of next.zones.filter((zone) => zone.routeId === route.id)) {
    zone.x = end.x - zone.width / 2;
    zone.y = end.y - zone.height / 2;
  }
  return next;
}
export function beginRouteSegment(
  scene: Scene,
  anchorId: string,
  routeId: string,
  point: Point,
  style: Pick<Route, 'colour' | 'lineStyle' | 'ending'>,
  newId: string,
  forceNew = false,
) {
  const next = structuredClone(scene);
  const anchor = [...next.players, ...next.opponentPlayers].find(
    (player) => player.id === anchorId,
  );
  let route = !forceNew
    ? next.routes.find(
        (route) =>
          route.id === routeId && (!anchorId || route.playerId === anchorId),
      )
    : undefined;
  if (!route && anchor && !forceNew) route = continuationRoute(next, anchor.id);
  if (!route && anchor) {
    route = {
      id: newId,
      playerId: anchor.id,
      startX: anchor.x,
      startY: anchor.y,
      endX: anchor.x,
      endY: anchor.y,
      points: [{ x: anchor.x, y: anchor.y }],
      ...style,
    };
    next.routes.push(route);
  }
  if (!route) return null;
  route.points = route.points?.length
    ? route.points
    : [
        { x: route.startX, y: route.startY },
        { x: route.endX, y: route.endY },
      ];
  route.points.push({ ...point });
  const index = route.points.length - 1;
  return {
    scene: moveRouteVertex(next, route.id, index, point),
    routeId: route.id,
    index,
  };
}
