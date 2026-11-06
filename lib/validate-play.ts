type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Diagram items must be objects.');
  return value as RecordValue;
};
const coordinate = (value: unknown, label: string, maximum = 720) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`Invalid ${label} in diagram.`);
};

export function validatePlayDiagram(body: RecordValue) {
  const arrays = ['players', 'routes', 'zones', 'labels', 'assignments'];
  for (const key of arrays) {
    const items = body[key] ?? [];
    if (!Array.isArray(items) || items.length > 200) throw new Error(`Invalid ${key}: expected up to 200 items.`);
    const ids = new Set<string>();
    for (const input of items) {
      const item = record(input);
      if (typeof item.id !== 'string' || !item.id || item.id.length > 100 || ids.has(item.id)) throw new Error(`Each ${key} item needs a unique ID.`);
      ids.add(item.id);
      if (key === 'assignments') {
        if (typeof item.position !== 'string' || !item.position.trim() || typeof item.title !== 'string' || !item.title.trim()) throw new Error('Every assignment needs a position and title.');
        continue;
      }
      if (item.colour !== undefined && (typeof item.colour !== 'string' || !/^#[a-f\d]{6}$/i.test(item.colour))) throw new Error('Choose a valid drawing colour.');
      if (key === 'routes') {
        for (const name of ['startX', 'endX']) coordinate(item[name], name);
        for (const name of ['startY', 'endY']) coordinate(item[name], name, 600);
        if (!['solid', 'dashed', 'dotted', 'curve'].includes(String(item.lineStyle))) throw new Error('Choose a valid route line style.');
        if (item.points !== undefined) {
          if (!Array.isArray(item.points) || item.points.length < 2 || item.points.length > 100) throw new Error('Routes need 2–100 points.');
          for (const point of item.points) { const value = record(point); coordinate(value.x, 'route x'); coordinate(value.y, 'route y', 600); }
        }
      } else {
        coordinate(item.x, 'x'); coordinate(item.y, 'y', 600);
        if (key === 'zones') { coordinate(item.width, 'zone width'); coordinate(item.height, 'zone height', 600); }
        if (key === 'players' && !['line', 'skill', 'qb', 'back'].includes(String(item.kind))) throw new Error('Choose a valid player symbol.');
      }
    }
  }
  if (body.fieldPosition !== undefined && (typeof body.fieldPosition !== 'number' || !Number.isFinite(body.fieldPosition) || body.fieldPosition < 0 || body.fieldPosition > 110)) throw new Error('Ball position must be between 0 and 110 yards.');
}
