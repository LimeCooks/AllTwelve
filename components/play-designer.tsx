'use client';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  GripHorizontal,
  Info,
  MousePointer2,
  Pencil,
  Plus,
  Redo2,
  Shapes,
  Trash2,
  Undo2,
  Users,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PlayField } from '@/components/play-field';
import {
  formationPlayers,
  normalizeDrawing,
  shiftScene,
  snapX,
  snapY,
  spotLabel,
  startingPlayers,
  type DesignerPlay,
  type Formation,
  type Point,
  type Route,
  type Scene,
  type Side,
  type Zone,
} from '@/lib/play-designer';

type Tool =
  | 'Select'
  | 'Route'
  | 'Player'
  | 'Ellipse'
  | 'Rectangle'
  | 'Triangle'
  | 'Label';
type Draft = {
  scene: Scene;
  name: string;
  concept: string;
  notes: string;
  family: DesignerPlay['family'];
  formationId: string | null;
  assignments: NonNullable<DesignerPlay['assignments']>;
  scope: 'team' | 'scout';
  opponent: string;
  packageName: string;
};
type Drag = {
  type: string;
  id: string;
  index?: number;
  point: Point;
  scene: Scene;
  moved: boolean;
};
const colours = [
  '#e5e9ef',
  '#52c5b5',
  '#ef665c',
  '#e2ae50',
  '#5c9fda',
  '#a479d5',
  '#78939e',
  '#e684be',
];

export function PlayDesigner({
  play,
  formation,
  formations,
  onSave,
  onBack,
  onEditingChange,
}: {
  play?: DesignerPlay;
  formation?: Formation;
  formations: Formation[];
  onSave: (value: Record<string, unknown>) => Promise<void>;
  onBack: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const source = play ?? formation!;
  const side = (play?.unit ?? formation?.unit ?? 'Offence') as Side;
  const [draft, setDraft] = useState<Draft>(() => {
    const scene = normalizeDrawing(source);
    if (!scene.players.length)
      scene.players = startingPlayers(side, scene.fieldPosition);
    return {
      scene,
      name: source.name,
      concept: play?.concept ?? '',
      notes: play?.notes ?? '',
      family: play?.family ?? 'Unassigned',
      formationId: play?.formationId ?? null,
      assignments: play?.assignments ?? [],
      scope: formation?.scope ?? 'team',
      opponent: formation?.opponent ?? '',
      packageName: formation?.packageName ?? '',
    };
  });
  const [history, setHistory] = useState<Draft[]>([]),
    [future, setFuture] = useState<Draft[]>([]);
  const [selected, setSelected] = useState('');
  const [tool, setTool] = useState<Tool>('Select');
  const [routeId, setRouteId] = useState('');
  const [anchorId, setAnchorId] = useState('');
  const [colour, setColour] = useState('#52c5b5');
  const [line, setLine] = useState<Route['lineStyle']>('solid');
  const [ending, setEnding] = useState<NonNullable<Route['ending']>>('arrow');
  const [detailsOpen, setDetailsOpen] = useState(false),
    [toolsOpen, setToolsOpen] = useState(false),
    [paletteOpen, setPaletteOpen] = useState(false);
  const [heightYards, setHeightYards] = useState(60);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [leaveOpen, setLeaveOpen] = useState(false),
    [dirty, setDirty] = useState(false);
  const [paletteOffset, setPaletteOffset] = useState({ x: 0, y: 0 });
  const [pendingFormation, setPendingFormation] = useState('');
  const drag = useRef<Drag | null>(null);
  const paletteDrag = useRef<{ start: Point; offset: Point } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const [kind, id] = selected.split(':');
  const player =
    kind === 'player'
      ? draft.scene.players.find((p) => p.id === id)
      : kind === 'opponent'
        ? draft.scene.opponentPlayers.find((p) => p.id === id)
        : undefined;
  const route =
    kind === 'route' ? draft.scene.routes.find((r) => r.id === id) : undefined;
  const zone =
    kind === 'zone' ? draft.scene.zones.find((z) => z.id === id) : undefined;
  const label =
    kind === 'label' ? draft.scene.labels.find((l) => l.id === id) : undefined;
  const ownFormations = formations.filter(
    (f) => f.scope !== 'scout' && f.unit === side,
  );
  const opponentSide =
    side === 'Defence'
      ? 'Offence'
      : side === 'Special teams'
        ? 'Special teams'
        : 'Defence';
  const scoutLooks = formations.filter((f) => f.unit === opponentSide);
  const snapshot = () => structuredClone(draft);
  const remember = () => {
    setHistory((items) => [...items.slice(-59), snapshot()]);
    setFuture([]);
    setDirty(true);
  };
  const edit = (changes: Partial<Draft>) => {
    if (busy) return;
    remember();
    setDraft((value) => ({ ...value, ...changes }));
  };
  const sceneEdit = (scene: Scene) => edit({ scene: normalizeDrawing(scene) });
  const finish = () => {
    setRouteId('');
    setAnchorId('');
    setTool('Select');
  };

  useEffect(() => {
    onEditingChange(dirty || busy);
    return () => onEditingChange(false);
  }, [dirty, busy, onEditingChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setFuture((items) => [...items, snapshot()]);
    setHistory((items) => items.slice(0, -1));
    setDraft(previous);
    setDirty(true);
    finish();
  };
  const redo = () => {
    const next = future.at(-1);
    if (!next) return;
    setHistory((items) => [...items, snapshot()]);
    setFuture((items) => items.slice(0, -1));
    setDraft(next);
    setDirty(true);
    finish();
  };
  const deleteSelected = () => {
    if (!selected) return;
    const next = structuredClone(draft.scene);
    if (kind === 'player') {
      next.players = next.players.filter((p) => p.id !== id);
      next.routes = next.routes.filter((r) => r.playerId !== id);
    }
    if (kind === 'opponent')
      next.opponentPlayers = next.opponentPlayers.filter((p) => p.id !== id);
    if (kind === 'route') next.routes = next.routes.filter((r) => r.id !== id);
    if (kind === 'zone') next.zones = next.zones.filter((z) => z.id !== id);
    if (kind === 'label') next.labels = next.labels.filter((l) => l.id !== id);
    sceneEdit(next);
    setSelected('');
    finish();
  };
  const changeColour = (value: string) => {
    setColour(value);
    if (!selected) return;
    const next = structuredClone(draft.scene);
    for (const list of [
      next.players,
      next.opponentPlayers,
      next.routes,
      next.zones,
      next.labels,
    ])
      for (const item of list) if (item.id === id) item.colour = value;
    sceneEdit(next);
  };
  const changeRoute = (patch: Partial<Route>) => {
    if (patch.lineStyle) setLine(patch.lineStyle);
    if (patch.ending) setEnding(patch.ending);
    if (route)
      sceneEdit({
        ...draft.scene,
        routes: draft.scene.routes.map((r) =>
          r.id === id ? { ...r, ...patch } : r,
        ),
      });
  };
  const changeZone = (patch: Partial<Zone>) => {
    if (zone)
      sceneEdit({
        ...draft.scene,
        zones: draft.scene.zones.map((z) =>
          z.id === id ? { ...z, ...patch } : z,
        ),
      });
  };
  const duplicate = () => {
    if (!selected) return;
    const next = structuredClone(draft.scene),
      newId = crypto.randomUUID();
    if (player) {
      const copy = {
        ...player,
        id: newId,
        x: Math.min(675, player.x + 20),
        y: player.y + 20,
      };
      if (kind === 'opponent') next.opponentPlayers.push(copy);
      else next.players.push(copy);
    }
    if (zone)
      next.zones.push({
        ...zone,
        id: newId,
        x: Math.min(685 - zone.width, zone.x + 20),
        y: zone.y + 20,
      });
    if (label)
      next.labels.push({
        ...label,
        id: newId,
        x: Math.min(675, label.x + 20),
        y: label.y + 20,
      });
    if (route) {
      const points = (route.points ?? []).map((p) => ({
        x: Math.min(680, p.x + 20),
        y: p.y + 20,
      }));
      next.routes.push({
        ...route,
        id: newId,
        playerId: undefined,
        points,
        startX: points[0].x,
        startY: points[0].y,
        endX: points.at(-1)!.x,
        endY: points.at(-1)!.y,
      });
    }
    sceneEdit(next);
    setSelected(`${kind}:${newId}`);
  };
  const pointAt = (event: ReactPointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return null;
    const p = event.currentTarget.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const local = p.matrixTransform(matrix.inverse());
    return {
      x: Math.max(45, Math.min(675, snapX(local.x))),
      y: snapY(local.y),
    };
  };
  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (busy || event.button !== 0) return;
    const p = pointAt(event);
    if (!p) return;
    svg.current = event.currentTarget;
    const hit = (event.target as Element).closest('[data-kind]');
    const hitKind = hit?.getAttribute('data-kind') ?? '',
      hitId = hit?.getAttribute('data-id') ?? '';
    const directRoute = tool === 'Select' && !hitKind && Boolean(player);
    if (tool === 'Select' && !directRoute) {
      if (!hitKind) {
        setSelected('');
        return;
      }
      const targetKind =
        hitKind === 'vertex'
          ? 'route'
          : hitKind === 'resize'
            ? 'zone'
            : hitKind;
      setSelected(`${targetKind}:${hitId}`);
      const chosen = [
        ...draft.scene.players,
        ...draft.scene.opponentPlayers,
        ...draft.scene.routes,
        ...draft.scene.zones,
        ...draft.scene.labels,
      ].find((item) => item.id === hitId);
      if (chosen?.colour) setColour(chosen.colour);
      drag.current = {
        type: hitKind,
        id: hitId,
        index: Number(hit?.getAttribute('data-index')),
        point: p,
        scene: structuredClone(draft.scene),
        moved: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (tool === 'Route' || directRoute) {
      if (hitKind === 'player' || hitKind === 'opponent') {
        setRouteId('');
        setAnchorId(hitId);
        setSelected(`${hitKind}:${hitId}`);
        return;
      }
      const anchor = [
        ...draft.scene.players,
        ...draft.scene.opponentPlayers,
      ].find((item) => item.id === (directRoute ? id : anchorId));
      if (directRoute) {
        setTool('Route');
        setAnchorId(id);
      }
      if (!routeId && !anchor) {
        setError('Select a player, then choose Draw route.');
        return;
      }
      const next = structuredClone(draft.scene);
      let current = next.routes.find((item) => item.id === routeId);
      if (!current && anchor) {
        current = {
          id: crypto.randomUUID(),
          playerId: anchor.id,
          startX: anchor.x,
          startY: anchor.y,
          endX: p.x,
          endY: p.y,
          points: [{ x: anchor.x, y: anchor.y }],
          colour,
          lineStyle: line,
          ending,
        };
        next.routes.push(current);
        setRouteId(current.id);
      }
      if (current) {
        current.points!.push(p);
        current.endX = p.x;
        current.endY = p.y;
        sceneEdit(next);
        setSelected(`route:${current.id}`);
      }
      return;
    }
    const next = structuredClone(draft.scene),
      newId = crypto.randomUUID();
    if (tool === 'Player') {
      next.players.push({
        id: newId,
        label: 'P',
        kind: 'skill',
        symbol: side === 'Defence' ? 'triangle' : 'circle',
        colour,
        ...p,
      });
      setSelected(`player:${newId}`);
    } else if (tool === 'Label') {
      next.labels.push({ id: newId, ...p, text: 'Label', colour });
      setSelected(`label:${newId}`);
    } else {
      next.zones.push({
        id: newId,
        x: Math.max(35, Math.min(585, p.x - 50)),
        y: p.y - 30,
        width: 100,
        height: 60,
        colour,
        shape: tool.toLowerCase() as Zone['shape'],
        opacity: 0.25,
        rotation: 0,
      });
      setSelected(`zone:${newId}`);
    }
    sceneEdit(next);
    setTool('Select');
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const action = drag.current;
    if (!action) return;
    const p = pointAt(event);
    if (!p) return;
    const dx = p.x - action.point.x,
      dy = p.y - action.point.y;
    if (!dx && !dy) return;
    if (!action.moved) remember();
    action.moved = true;
    const next = structuredClone(action.scene);
    if (action.type === 'player' || action.type === 'opponent') {
      const list =
        action.type === 'player' ? next.players : next.opponentPlayers;
      const target = list.find((item) => item.id === action.id);
      if (!target) return;
      target.x = Math.min(675, Math.max(45, target.x + dx));
      target.y += dy;
      for (const r of next.routes.filter(
        (item) => item.playerId === action.id,
      )) {
        r.startX = target.x;
        r.startY = target.y;
        if (r.points?.length) r.points[0] = { x: target.x, y: target.y };
      }
    } else if (action.type === 'resize') {
      const z = next.zones.find((item) => item.id === action.id);
      if (z) {
        const angle = (-(z.rotation ?? 0) * Math.PI) / 180;
        const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
        const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
        const width = Math.max(
          10,
          Math.min(600, z.width + (action.index === 0 ? localX * 2 : 0)),
        );
        const height = Math.max(
          10,
          Math.min(600, z.height + (action.index === 1 ? localY * 2 : 0)),
        );
        z.x -= (width - z.width) / 2;
        z.y -= (height - z.height) / 2;
        z.width = width;
        z.height = height;
      }
    } else if (action.type === 'zone') {
      const z = next.zones.find((item) => item.id === action.id);
      if (z) {
        z.x = Math.min(685 - z.width, Math.max(35, z.x + dx));
        z.y += dy;
        const attached = next.routes.find((r) => r.id === z.routeId);
        if (attached) {
          attached.endX = z.x + z.width / 2;
          attached.endY = z.y + z.height / 2;
          if (attached.points?.length)
            attached.points[attached.points.length - 1] = {
              x: attached.endX,
              y: attached.endY,
            };
        }
      }
    } else if (action.type === 'label') {
      const l = next.labels.find((item) => item.id === action.id);
      if (l) {
        l.x = Math.min(675, Math.max(45, l.x + dx));
        l.y += dy;
      }
    } else {
      const r = next.routes.find((item) => item.id === action.id);
      if (r?.points?.length) {
        const index =
          action.type === 'vertex' ? action.index! : r.points.length - 1;
        if (index > 0 && index < r.points.length) r.points[index] = p;
        const end = r.points.at(-1)!;
        r.endX = end.x;
        r.endY = end.y;
        for (const z of next.zones.filter((z) => z.routeId === r.id)) {
          z.x = end.x - z.width / 2;
          z.y = end.y - z.height / 2;
        }
      }
    }
    setDraft((value) => ({ ...value, scene: next }));
  };
  const pointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  const save = async () => {
    if (busy) return;
    if (!draft.name.trim() || (!formation && !draft.concept.trim())) {
      setDetailsOpen(true);
      setError('Enter a name and concept before saving.');
      return;
    }
    if (formation && draft.scope === 'scout' && !draft.opponent.trim()) {
      setDetailsOpen(true);
      setError('Name the scout opponent before saving.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave({
        ...(play ?? formation),
        ...draft.scene,
        name: draft.name.trim(),
        concept: draft.concept.trim(),
        notes: draft.notes,
        family: draft.family,
        formationId: draft.formationId,
        assignments: draft.assignments,
        scope: draft.scope,
        opponent: draft.opponent.trim(),
        packageName: draft.packageName.trim(),
      });
      setDirty(false);
      onEditingChange(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to save. Your draft is still open.',
      );
    } finally {
      setBusy(false);
    }
  };
  const toggleOpponent = () => {
    if (draft.scene.showOpponent)
      sceneEdit({ ...draft.scene, showOpponent: false });
    else {
      setDetailsOpen(true);
      setError('Choose a saved opponent alignment in Looks.');
    }
  };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (
        (event.target as Element)?.closest(
          'input,textarea,select,[contenteditable="true"]',
        )
      )
        return;
      if (busy) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (event.key === 'Escape') {
        finish();
        setSelected('');
        setToolsOpen(false);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selected) {
          event.preventDefault();
          deleteSelected();
        }
      } else if (
        player &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        event.preventDefault();
        const dx =
          event.key === 'ArrowLeft' ? -10 : event.key === 'ArrowRight' ? 10 : 0;
        const dy =
          event.key === 'ArrowUp' ? -10 : event.key === 'ArrowDown' ? 10 : 0;
        const list = kind === 'opponent' ? 'opponentPlayers' : 'players';
        const moved = {
          ...player,
          x: Math.min(675, Math.max(45, player.x + dx)),
          y: player.y + dy,
        };
        sceneEdit({
          ...draft.scene,
          [list]: draft.scene[list].map((p) => (p.id === id ? moved : p)),
          routes: draft.scene.routes.map((r) =>
            r.playerId === id
              ? {
                  ...r,
                  startX: moved.x,
                  startY: moved.y,
                  points: r.points?.map((p, index) =>
                    index === 0 ? { x: moved.x, y: moved.y } : p,
                  ),
                }
              : r,
          ),
        });
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });
  return (
    <div className="pd-designer" ref={root} aria-busy={busy}>
      <header className="pd-header">
        <Button
          aria-label="Back to library"
          disabled={busy}
          onClick={() => (dirty ? setLeaveOpen(true) : onBack())}
          size="icon"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <div>
          <strong>{draft.name || 'Untitled'}</strong>
          <span>
            {side}
            {formation
              ? ` · ${draft.scope === 'scout' ? draft.opponent || 'Scout' : 'Our team'}`
              : ''}{' '}
            · {dirty ? 'Unsaved changes' : 'Saved'}
          </span>
        </div>
        <div className="pd-header-actions">
          <Button
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
            variant="outline"
          >
            <Info /> Details & looks
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            <Check /> {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>
      {error ? (
        <div className="pd-error" role="alert">
          {error}
          <button
            aria-label="Dismiss message"
            onClick={() => setError('')}
            type="button"
          >
            <X />
          </button>
        </div>
      ) : null}
      <div className="pd-workarea" inert={busy}>
        <div className="pd-canvas">
          <PlayField
            drawing={draft.scene}
            name={draft.name}
            selected={selected}
            heightYards={heightYards}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
          />
          <div className="pd-main-tools">
            <Button
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((open) => !open)}
              variant="outline"
            >
              <Shapes /> Tools <ChevronDown />
            </Button>
            {toolsOpen ? (
              <div className="pd-tool-menu">
                {(
                  [
                    'Select',
                    'Route',
                    'Player',
                    'Ellipse',
                    'Rectangle',
                    'Triangle',
                    'Label',
                  ] as Tool[]
                ).map((item) => (
                  <button
                    className={tool === item ? 'active' : ''}
                    key={item}
                    onClick={() => {
                      if (item === 'Route') {
                        if (player) {
                          setAnchorId(player.id);
                          setRouteId('');
                        } else if (route) {
                          setRouteId(route.id);
                          setAnchorId(route.playerId ?? '');
                        } else {
                          setError('Select one of your players first.');
                          return;
                        }
                      } else finish();
                      setTool(item);
                      setToolsOpen(false);
                    }}
                    type="button"
                  >
                    {item === 'Ellipse'
                      ? 'Oval / circle zone'
                      : item === 'Rectangle'
                        ? 'Rectangle zone'
                        : item === 'Triangle'
                          ? 'Triangle zone'
                          : item}
                  </button>
                ))}
              </div>
            ) : null}
            <Button
              aria-label="Select and move"
              aria-pressed={tool === 'Select'}
              onClick={finish}
              size="icon"
              variant="ghost"
            >
              <MousePointer2 />
            </Button>
            <Button
              aria-label="Undo"
              disabled={!history.length}
              onClick={undo}
              size="icon"
              variant="ghost"
            >
              <Undo2 />
            </Button>
            <Button
              aria-label="Redo"
              disabled={!future.length}
              onClick={redo}
              size="icon"
              variant="ghost"
            >
              <Redo2 />
            </Button>
            <span className="pd-tool-status">
              {tool}
              {tool === 'Route' ? ' · click to extend' : ''}
            </span>
            {tool === 'Route' ? (
              <Button onClick={finish} size="sm" variant="outline">
                <Check /> Finish route
              </Button>
            ) : null}
          </div>
          <div className="pd-field-controls">
            <label htmlFor="pd-ball">
              Ball
              <Input
                aria-label="Ball position in yards from own goal"
                id="pd-ball"
                type="number"
                min="1"
                max="109"
                value={draft.scene.fieldPosition}
                onChange={(event) => {
                  const spot = Number(event.target.value);
                  if (Number.isInteger(spot) && spot >= 1 && spot <= 109)
                    sceneEdit(shiftScene(draft.scene, spot));
                }}
              />
            </label>
            <span>{spotLabel(draft.scene.fieldPosition)}</span>
            <NativeSelect
              aria-label="Field zoom"
              onChange={(event) => setHeightYards(Number(event.target.value))}
              value={String(heightYards)}
            >
              <NativeSelectOption value="30">30 yards</NativeSelectOption>
              <NativeSelectOption value="60">60 yards</NativeSelectOption>
              <NativeSelectOption value="140">Full field</NativeSelectOption>
            </NativeSelect>
          </div>
          {selected ? (
            <section
              className={`pd-properties${paletteOpen ? ' open' : ''}`}
              style={{
                transform: `translate(${paletteOffset.x}px, ${paletteOffset.y}px)`,
              }}
            >
              <header>
                <button
                  className="pd-drag-handle"
                  aria-label="Drag editing controls"
                  type="button"
                  onPointerDown={(event) => {
                    paletteDrag.current = {
                      start: { x: event.clientX, y: event.clientY },
                      offset: paletteOffset,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const action = paletteDrag.current;
                    if (!action) return;
                    const bounds = root.current?.getBoundingClientRect();
                    const paletteBounds = event.currentTarget
                      .closest('section')
                      ?.getBoundingClientRect();
                    const maxX = Math.max(
                      0,
                      (bounds?.width ?? 1000) -
                        (paletteBounds?.width ?? 470) -
                        32,
                    );
                    const maxY = Math.max(
                      0,
                      (bounds?.height ?? 700) -
                        (paletteBounds?.height ?? 200) -
                        90,
                    );
                    setPaletteOffset({
                      x: Math.max(
                        -8,
                        Math.min(
                          maxX,
                          action.offset.x + event.clientX - action.start.x,
                        ),
                      ),
                      y: Math.max(
                        -maxY,
                        Math.min(
                          12,
                          action.offset.y + event.clientY - action.start.y,
                        ),
                      ),
                    });
                  }}
                  onPointerUp={() => {
                    paletteDrag.current = null;
                  }}
                >
                  <GripHorizontal />
                </button>
                <strong>
                  {player
                    ? `${kind === 'opponent' ? 'Opponent · ' : ''}${player.label}`
                    : zone
                      ? `${zone.shape ?? 'ellipse'} zone`
                      : route
                        ? 'Route'
                        : 'Label'}
                </strong>
                <Button
                  aria-label="Duplicate selection"
                  onClick={duplicate}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Copy />
                </Button>
                <Button
                  aria-label="Delete selection"
                  onClick={deleteSelected}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
                <Button
                  aria-expanded={paletteOpen}
                  onClick={() => setPaletteOpen((open) => !open)}
                  size="sm"
                  variant="outline"
                >
                  Edit <ChevronDown />
                </Button>
                {player ? (
                  <Button
                    onClick={() => {
                      setAnchorId(player.id);
                      setRouteId('');
                      setTool('Route');
                    }}
                    size="sm"
                  >
                    <Pencil /> Route
                  </Button>
                ) : route ? (
                  <Button
                    onClick={() => {
                      setRouteId(route.id);
                      setAnchorId(route.playerId ?? '');
                      setTool('Route');
                    }}
                    size="sm"
                  >
                    Extend
                  </Button>
                ) : null}
                {route ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const existing = draft.scene.zones.find(
                        (z) => z.routeId === route.id,
                      );
                      if (existing) {
                        setSelected(`zone:${existing.id}`);
                        finish();
                        return;
                      }
                      const end = route.points?.at(-1) ?? {
                        x: route.endX,
                        y: route.endY,
                      };
                      const zoneId = crypto.randomUUID();
                      sceneEdit({
                        ...draft.scene,
                        zones: [
                          ...draft.scene.zones,
                          {
                            id: zoneId,
                            routeId: route.id,
                            x: end.x - 50,
                            y: end.y - 30,
                            width: 100,
                            height: 60,
                            colour: route.colour,
                            shape: 'ellipse',
                            opacity: 0.25,
                          },
                        ],
                      });
                      finish();
                      setSelected(`zone:${zoneId}`);
                    }}
                  >
                    Coverage at end
                  </Button>
                ) : null}
                <button
                  aria-label="Clear selection"
                  onClick={() => {
                    setSelected('');
                    finish();
                  }}
                  type="button"
                >
                  <X />
                </button>
              </header>
              {paletteOpen ? (
                <div className="pd-properties-body">
                  <div className="pd-colours">
                    {colours.map((value) => (
                      <button
                        aria-label={`Colour ${value}`}
                        aria-pressed={colour === value}
                        key={value}
                        style={{ background: value }}
                        onClick={() => changeColour(value)}
                        type="button"
                      />
                    ))}
                  </div>
                  {player ? (
                    <div className="pd-property-row">
                      <label htmlFor="pd-control-1">
                        Label
                        <Input
                          id="pd-control-1"
                          aria-label="Selected player label"
                          maxLength={6}
                          value={player.label}
                          onChange={(event) => {
                            const list =
                              kind === 'opponent'
                                ? 'opponentPlayers'
                                : 'players';
                            sceneEdit({
                              ...draft.scene,
                              [list]: draft.scene[list].map((p) =>
                                p.id === id
                                  ? { ...p, label: event.target.value }
                                  : p,
                              ),
                            });
                          }}
                        />
                      </label>
                      <label htmlFor="pd-control-2">
                        Symbol
                        <NativeSelect
                          id="pd-control-2"
                          aria-label="Player symbol"
                          value={player.symbol ?? 'circle'}
                          onChange={(event) => {
                            const list =
                              kind === 'opponent'
                                ? 'opponentPlayers'
                                : 'players';
                            sceneEdit({
                              ...draft.scene,
                              [list]: draft.scene[list].map((p) =>
                                p.id === id
                                  ? {
                                      ...p,
                                      symbol: event.target.value as
                                        | 'circle'
                                        | 'triangle'
                                        | 'square',
                                    }
                                  : p,
                              ),
                            });
                          }}
                        >
                          <NativeSelectOption value="circle">
                            Circle
                          </NativeSelectOption>
                          <NativeSelectOption value="triangle">
                            Triangle
                          </NativeSelectOption>
                          <NativeSelectOption value="square">
                            Square
                          </NativeSelectOption>
                        </NativeSelect>
                      </label>
                    </div>
                  ) : null}
                  {route || player ? (
                    <div className="pd-property-row">
                      <label htmlFor="pd-control-3">
                        Line
                        <NativeSelect
                          id="pd-control-3"
                          aria-label="Route line style"
                          value={route?.lineStyle ?? line}
                          onChange={(event) =>
                            changeRoute({
                              lineStyle: event.target
                                .value as Route['lineStyle'],
                            })
                          }
                        >
                          {['solid', 'dashed', 'dotted', 'curve'].map(
                            (style) => (
                              <NativeSelectOption key={style} value={style}>
                                {style}
                              </NativeSelectOption>
                            ),
                          )}
                        </NativeSelect>
                      </label>
                      <label htmlFor="pd-control-4">
                        Ending
                        <NativeSelect
                          id="pd-control-4"
                          aria-label="Route ending"
                          value={route?.ending ?? ending}
                          onChange={(event) =>
                            changeRoute({
                              ending: event.target.value as Route['ending'],
                            })
                          }
                        >
                          <NativeSelectOption value="arrow">
                            Arrow
                          </NativeSelectOption>
                          <NativeSelectOption value="bar">
                            Block / bar
                          </NativeSelectOption>
                          <NativeSelectOption value="none">
                            None
                          </NativeSelectOption>
                        </NativeSelect>
                      </label>
                    </div>
                  ) : null}
                  {zone ? (
                    <>
                      <p>
                        Drag the white bars on the coverage shape to resize its
                        width and depth.
                      </p>
                      <div className="pd-property-row">
                        <label htmlFor="pd-control-7">
                          Shape
                          <NativeSelect
                            id="pd-control-7"
                            aria-label="Coverage shape"
                            value={zone.shape ?? 'ellipse'}
                            onChange={(event) =>
                              changeZone({
                                shape: event.target.value as Zone['shape'],
                              })
                            }
                          >
                            <NativeSelectOption value="ellipse">
                              Oval / circle
                            </NativeSelectOption>
                            <NativeSelectOption value="rectangle">
                              Rectangle
                            </NativeSelectOption>
                            <NativeSelectOption value="triangle">
                              Triangle
                            </NativeSelectOption>
                          </NativeSelect>
                        </label>
                        <label htmlFor="pd-control-8">
                          Rotation
                          <Input
                            id="pd-control-8"
                            aria-label="Zone rotation"
                            type="number"
                            min="-180"
                            max="180"
                            value={zone.rotation ?? 0}
                            onChange={(event) =>
                              changeZone({
                                rotation: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                      </div>
                      <label htmlFor="pd-control-9">
                        Opacity
                        <Input
                          id="pd-control-9"
                          aria-label="Zone opacity"
                          type="range"
                          min="0.1"
                          max="0.8"
                          step="0.05"
                          value={zone.opacity ?? 0.25}
                          onChange={(event) =>
                            changeZone({ opacity: Number(event.target.value) })
                          }
                        />
                      </label>
                    </>
                  ) : null}
                  {label ? (
                    <Input
                      aria-label="Diagram label text"
                      value={label.text}
                      onChange={(event) =>
                        sceneEdit({
                          ...draft.scene,
                          labels: draft.scene.labels.map((l) =>
                            l.id === id
                              ? { ...l, text: event.target.value }
                              : l,
                          ),
                        })
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : (
            <p className="pd-bottom-hint">
              Select a player to draw a route. Tools adds players, coverage
              shapes, and labels. Drag snaps to one yard.
            </p>
          )}
        </div>
        {detailsOpen ? (
          <aside className="pd-details">
            <header>
              <strong>
                {formation ? 'Formation details' : 'Play details'}
              </strong>
              <Button
                aria-label="Close details"
                onClick={() => setDetailsOpen(false)}
                size="icon-sm"
                variant="ghost"
              >
                <X />
              </Button>
            </header>
            <label htmlFor="pd-control-10">
              Name
              <Input
                id="pd-control-10"
                aria-label="Drawing name"
                value={draft.name}
                onChange={(event) => edit({ name: event.target.value })}
              />
            </label>
            {formation ? (
              <>
                <label htmlFor="pd-control-11">
                  Owner
                  <NativeSelect
                    id="pd-control-11"
                    aria-label="Formation ownership"
                    value={draft.scope}
                    onChange={(event) =>
                      edit({ scope: event.target.value as Draft['scope'] })
                    }
                  >
                    <NativeSelectOption value="team">
                      Our team
                    </NativeSelectOption>
                    <NativeSelectOption value="scout">
                      Opponent / scout
                    </NativeSelectOption>
                  </NativeSelect>
                </label>
                {draft.scope === 'scout' ? (
                  <label htmlFor="pd-control-12">
                    Opponent
                    <Input
                      id="pd-control-12"
                      aria-label="Scout opponent"
                      placeholder="Example: NKEC"
                      value={draft.opponent}
                      onChange={(event) =>
                        edit({ opponent: event.target.value })
                      }
                    />
                  </label>
                ) : null}
                <label htmlFor="pd-control-13">
                  Package (optional)
                  <Input
                    id="pd-control-13"
                    aria-label="Formation package name"
                    placeholder="Your name: Jumbo, Nascar…"
                    value={draft.packageName}
                    onChange={(event) =>
                      edit({ packageName: event.target.value })
                    }
                  />
                </label>
                <p>
                  {side} · {draft.scene.players.length} players. This alignment
                  can be selected when creating a play.
                </p>
              </>
            ) : (
              <>
                <label htmlFor="pd-control-14">
                  Concept
                  <Input
                    id="pd-control-14"
                    aria-label="Play concept"
                    value={draft.concept}
                    onChange={(event) => edit({ concept: event.target.value })}
                  />
                </label>
                <label htmlFor="pd-control-15">
                  Play type
                  <NativeSelect
                    id="pd-control-15"
                    aria-label="Play type"
                    value={draft.family}
                    onChange={(event) =>
                      edit({ family: event.target.value as Draft['family'] })
                    }
                  >
                    {Array.from(
                      new Set([
                        draft.family,
                        ...(side === 'Defence'
                          ? ['Unassigned', 'Coverage', 'Pressure', 'Run fit']
                          : side === 'Special teams'
                            ? [
                                'Unassigned',
                                'Kickoff',
                                'Kick return',
                                'Punt',
                                'Punt return',
                                'Field goal',
                              ]
                            : ['Unassigned', 'Run', 'Pass', 'RPO', 'Screen']),
                      ]),
                    ).map((value) => (
                      <NativeSelectOption key={value} value={value}>
                        {value}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
                <details>
                  <summary>Our formation</summary>
                  <NativeSelect
                    aria-label="Apply our formation"
                    value=""
                    onChange={(event) =>
                      setPendingFormation(event.target.value)
                    }
                  >
                    <NativeSelectOption value="">
                      Choose saved alignment…
                    </NativeSelectOption>
                    {ownFormations.map((f) => (
                      <NativeSelectOption key={f.id} value={f.id}>
                        {f.name}
                        {f.packageName ? ` · ${f.packageName}` : ''}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <p>
                    Applying an alignment replaces our players and routes. Undo
                    restores the previous drawing.
                  </p>
                </details>
                <details>
                  <summary>Looks · opponent</summary>
                  <Button onClick={toggleOpponent} size="sm" variant="outline">
                    <Users />{' '}
                    {draft.scene.showOpponent
                      ? 'Hide opponent'
                      : 'Show opponent'}
                  </Button>
                  <NativeSelect
                    aria-label="Opponent formation"
                    value={draft.scene.opponentFormationId ?? ''}
                    onChange={(event) => {
                      const look = formations.find(
                        (f) => f.id === event.target.value,
                      );
                      if (!look) return;
                      sceneEdit({
                        ...draft.scene,
                        showOpponent: true,
                        opponentFormationId: look.id,
                        opponentPlayers: formationPlayers(
                          look,
                          draft.scene.fieldPosition,
                          true,
                        ).map((p) => ({ ...p, colour: '#9aa5b1' })),
                      });
                    }}
                  >
                    <NativeSelectOption value="">
                      Choose a saved {opponentSide.toLowerCase()} look…
                    </NativeSelectOption>
                    {scoutLooks.map((f) => (
                      <NativeSelectOption key={f.id} value={f.id}>
                        {f.scope === 'scout'
                          ? `${f.opponent} · `
                          : 'Our team · '}
                        {f.name}
                        {f.packageName ? ` · ${f.packageName}` : ''}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <p>
                    Scout looks are drawn in Formations. Opponent positions can
                    be adjusted in this play without changing the source.
                  </p>
                </details>
                <details>
                  <summary>Assignments & notes</summary>
                  {draft.assignments.map((a) => (
                    <div className="pd-assignment" key={a.id}>
                      <Input
                        aria-label="Assignment position"
                        value={a.position}
                        onChange={(event) =>
                          edit({
                            assignments: draft.assignments.map((item) =>
                              item.id === a.id
                                ? { ...item, position: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                      <Input
                        aria-label="Assignment title"
                        value={a.title}
                        onChange={(event) =>
                          edit({
                            assignments: draft.assignments.map((item) =>
                              item.id === a.id
                                ? { ...item, title: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                      <Textarea
                        aria-label="Assignment detail"
                        value={a.detail}
                        onChange={(event) =>
                          edit({
                            assignments: draft.assignments.map((item) =>
                              item.id === a.id
                                ? { ...item, detail: event.target.value }
                                : item,
                            ),
                          })
                        }
                      />
                      <Button
                        aria-label="Remove assignment"
                        onClick={() =>
                          edit({
                            assignments: draft.assignments.filter(
                              (item) => item.id !== a.id,
                            ),
                          })
                        }
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button
                    onClick={() =>
                      edit({
                        assignments: [
                          ...draft.assignments,
                          {
                            id: crypto.randomUUID(),
                            position: `P${draft.assignments.length + 1}`,
                            title: 'Assignment',
                            detail: '',
                          },
                        ],
                      })
                    }
                    size="sm"
                    variant="outline"
                  >
                    <Plus /> Assignment
                  </Button>
                  <label htmlFor="pd-control-16">
                    Coaching notes
                    <Textarea
                      id="pd-control-16"
                      aria-label="Coaching notes"
                      value={draft.notes}
                      onChange={(event) => edit({ notes: event.target.value })}
                    />
                  </label>
                </details>
              </>
            )}
          </aside>
        ) : null}
      </div>
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="athlete-dialog">
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              Your last saved drawing will be kept.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setLeaveOpen(false)} variant="outline">
              Keep editing
            </Button>
            <Button
              onClick={() => {
                onEditingChange(false);
                onBack();
              }}
              variant="destructive"
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(pendingFormation)}
        onOpenChange={(open) => {
          if (!open) setPendingFormation('');
        }}
      >
        <DialogContent className="athlete-dialog">
          <DialogHeader>
            <DialogTitle>Apply this formation?</DialogTitle>
            <DialogDescription>
              This replaces our players and clears their routes. Coverage shapes
              and the opponent look remain. Undo can restore the old drawing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPendingFormation('')} variant="outline">
              Cancel
            </Button>
            <Button
              onClick={() => {
                const f = formations.find(
                  (item) => item.id === pendingFormation,
                );
                if (!f) return;
                edit({
                  formationId: f.id,
                  scene: {
                    ...draft.scene,
                    players: formationPlayers(f, draft.scene.fieldPosition),
                    routes: [],
                  },
                });
                setPendingFormation('');
                setSelected('');
                finish();
              }}
            >
              Apply formation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
