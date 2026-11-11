import { normalizeDrawing, yardY, type Drawing } from '@/lib/play-designer';

export function printViewBox(drawing: Drawing) {
  const scene = normalizeDrawing(drawing),
    los = yardY(scene.fieldPosition);
  const opponents = new Set(scene.opponentPlayers.map((player) => player.id));
  const routes = scene.routes.filter(
    (route) =>
      scene.showOpponent || !route.playerId || !opponents.has(route.playerId),
  );
  const hidden = new Set(
    scene.routes
      .filter((route) => !routes.includes(route))
      .map((route) => route.id),
  );
  let left = 0,
    right = 720,
    top = los - 130,
    bottom = los + 130;
  const add = (x: number, y: number, rx = 16, ry = 16) => {
    left = Math.min(left, x - rx);
    right = Math.max(right, x + rx);
    top = Math.min(top, y - ry);
    bottom = Math.max(bottom, y + ry);
  };
  for (const player of [
    ...scene.players,
    ...(scene.showOpponent ? scene.opponentPlayers : []),
  ])
    add(
      player.x,
      player.y,
      Math.max(16, Array.from(player.label).length * 5),
      16,
    );
  for (const route of routes)
    for (const point of route.points?.length
      ? route.points
      : [
          { x: route.startX, y: route.startY },
          { x: route.endX, y: route.endY },
        ])
      add(point.x, point.y, 20, 20);
  for (const zone of scene.zones.filter(
    (zone) => !zone.routeId || !hidden.has(zone.routeId),
  )) {
    const angle = ((zone.rotation ?? 0) * Math.PI) / 180,
      rx =
        (Math.abs(Math.cos(angle)) * zone.width +
          Math.abs(Math.sin(angle)) * zone.height) /
        2,
      ry =
        (Math.abs(Math.sin(angle)) * zone.width +
          Math.abs(Math.cos(angle)) * zone.height) /
        2;
    add(zone.x + zone.width / 2, zone.y + zone.height / 2, rx + 12, ry + 12);
  }
  for (const label of scene.labels)
    add(label.x, label.y, Math.max(15, Array.from(label.text).length * 6), 16);
  const height = Math.max(350, bottom - top + 30),
    center = (top + bottom) / 2;
  return { x: left, y: center - height / 2, width: right - left, height };
}

export function inkColour(colour: string) {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) return colour;
  const values = [1, 3, 5].map((index) =>
    Number.parseInt(colour.slice(index, index + 2), 16),
  );
  if (Math.min(...values) > 180) return '#243447';
  return (
    '#' +
    values
      .map((value) =>
        Math.round(value * 0.68)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export function wrapPrintText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
) {
  const lines: string[] = [];
  for (const paragraph of text.replaceAll('\r\n', '\n').split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (measure(line ? line + ' ' + word : word) <= maxWidth) {
        line = line ? line + ' ' + word : word;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      for (const character of Array.from(word)) {
        if (line && measure(line + character) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
