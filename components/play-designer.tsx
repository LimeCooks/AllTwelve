'use client';
import { Brand } from '@/components/brand';
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
  Hand,
  ZoomIn,
  ZoomOut,
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
import { WorkspaceSelect } from '@/components/ui/select';
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
import { fieldViewport } from '@/lib/field-camera';
import {
  beginRouteSegment,
  continuationRoute,
  moveRouteVertex,
} from '@/lib/route-edit';
import {
  formationPlayers,
  normalizeDrawing,
  removeSceneItem,
  replaceScenePlayers,
  shiftScene,
  snapX,
  snapY,
  spotLabel,
  yardY,
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
  | 'Pan'
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
  pointerId: number;
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
  onReload,
  onBack,
  onEditingChange,
}: {
  play?: DesignerPlay;
  formation?: Formation;
  formations: Formation[];
  onSave: (value: Record<string, unknown>) => Promise<void>;
  onReload: () => Promise<void>;
  onBack: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const source = play ?? formation!;
  const saveLock = useRef(false);
  const [reloadOpen, setReloadOpen] = useState(false);
  const [draftDownload, setDraftDownload] = useState('');
  useEffect(
    () => () => {
      if (draftDownload) URL.revokeObjectURL(draftDownload);
    },
    [draftDownload],
  );
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
  const [forceNewRoute, setForceNewRoute] = useState(false);
  const [guides, setGuides] = useState<Point | null>(null);
  const [colour, setColour] = useState('#52c5b5');
  const [line, setLine] = useState<Route['lineStyle']>('solid');
  const [ending, setEnding] = useState<NonNullable<Route['ending']>>('arrow');
  const [detailsOpen, setDetailsOpen] = useState(false),
    [toolsOpen, setToolsOpen] = useState(false),
    [paletteOpen, setPaletteOpen] = useState(false);
  const [heightYards, setHeightYards] = useState(60);
  const [zoom, setZoom] = useState(1);
  const [cameraPan, setCameraPan] = useState({ x: 0, y: 0 });
  const cameraDrag = useRef<{
    pointerId: number;
    start: Point;
    pan: Point;
    scale: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [leaveOpen, setLeaveOpen] = useState(false),
    [dirty, setDirty] = useState(false);
  const [paletteOffset, setPaletteOffset] = useState({ x: 0, y: 0 });
  const [pendingFormation, setPendingFormation] = useState('');
  const drag = useRef<Drag | null>(null);
  const paletteDrag = useRef<{
    pointerId: number;
    start: Point;
    offset: Point;
  } | null>(null);
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
    setForceNewRoute(false);
    setGuides(null);
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
    sceneEdit(removeSceneItem(draft.scene, kind, id));
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
    if (
      busy ||
      drag.current ||
      cameraDrag.current ||
      event.button !== 0 ||
      !event.isPrimary
    )
      return;
    if (tool === 'Pan') {
      const matrix = event.currentTarget.getScreenCTM();
      if (!matrix) return;
      const viewport = fieldViewport(
        yardY(draft.scene.fieldPosition),
        heightYards,
        zoom,
        cameraPan,
      );
      cameraDrag.current = {
        pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY },
        pan: viewport.pan,
        scale: matrix.a,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
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
      if (hitKind === 'player' || hitKind === 'opponent') {
        setAnchorId(hitId);
        setRouteId(continuationRoute(draft.scene, hitId)?.id ?? '');
        setForceNewRoute(false);
      }
      drag.current = {
        pointerId: event.pointerId,
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
        setRouteId(continuationRoute(draft.scene, hitId)?.id ?? '');
        setForceNewRoute(false);
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
      const segment = beginRouteSegment(
        draft.scene,
        anchor?.id ?? anchorId,
        routeId,
        p,
        { colour, lineStyle: line, ending },
        crypto.randomUUID(),
        forceNewRoute,
      );
      if (!segment) return;
      setForceNewRoute(false);
      setRouteId(segment.routeId);
      sceneEdit(segment.scene);
      setSelected(`route:${segment.routeId}`);
      drag.current = {
        pointerId: event.pointerId,
        type: 'route-draw',
        id: segment.routeId,
        index: segment.index,
        point: p,
        scene: segment.scene,
        moved: true,
      };
      setGuides(p);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
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
    const camera = cameraDrag.current;
    if (camera?.pointerId === event.pointerId) {
      setCameraPan(
        fieldViewport(yardY(draft.scene.fieldPosition), heightYards, zoom, {
          x: camera.pan.x - (event.clientX - camera.start.x) / camera.scale,
          y: camera.pan.y - (event.clientY - camera.start.y) / camera.scale,
        }).pan,
      );
      return;
    }
    const action = drag.current;
    if (!action || action.pointerId !== event.pointerId) return;
    const p = pointAt(event);
    if (!p) return;
    const dx = p.x - action.point.x,
      dy = p.y - action.point.y;
    if (action.type === 'route-draw') {
      setDraft((value) => ({
        ...value,
        scene: moveRouteVertex(action.scene, action.id, action.index!, p),
      }));
      setGuides(p);
      return;
    }
    if (!dx && !dy) return;
    if (!action.moved) remember();
    action.moved = true;
    setGuides(p);
    const next = structuredClone(action.scene);
    if (action.type === 'player' || action.type === 'opponent') {
      const list =
        action.type === 'player' ? next.players : next.opponentPlayers;
      const target = list.find((item) => item.id === action.id);
      if (!target) return;
      target.x = Math.min(675, Math.max(45, target.x + dx));
      target.y += dy;
      setGuides({ x: target.x, y: target.y });
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
    if (
      cameraDrag.current?.pointerId !== event.pointerId &&
      drag.current?.pointerId !== event.pointerId
    )
      return;
    if (
      event.type === 'pointerup' &&
      drag.current?.pointerId === event.pointerId
    )
      pointerMove(event);
    if (cameraDrag.current?.pointerId === event.pointerId)
      cameraDrag.current = null;
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
    setGuides(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const changeZoom = (value: number) => {
    const next = Math.max(1, Math.min(6, value));
    setZoom(next);
    setCameraPan(
      fieldViewport(
        yardY(draft.scene.fieldPosition),
        heightYards,
        next,
        cameraPan,
      ).pan,
    );
  };
  const savePayload = () => ({
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
  const downloadDraft = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: 'alltwelve-designer-draft-v1',
              kind: formation ? 'formation' : 'play',
              savedAt: new Date().toISOString(),
              data: savePayload(),
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      ),
    );
    setDraftDownload(url);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'alltwelve-designer-draft.json';
    link.click();
  };
  const reloadSaved = async () => {
    if (saveLock.current) return;
    saveLock.current = true;
    setBusy(true);
    try {
      await onReload();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to reload. Your draft is still open.',
      );
      setReloadOpen(false);
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  };
  const save = async () => {
    if (saveLock.current) return;
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
    saveLock.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(savePayload());
      setDirty(false);
      onEditingChange(false);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to save. Your draft is still open.',
      );
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  };
  const toggleOpponent = () => {
    if (draft.scene.showOpponent) {
      sceneEdit({ ...draft.scene, showOpponent: false });
      setSelected('');
      finish();
    } else {
      setDetailsOpen(true);
      setError('Choose a saved opponent alignment in Looks.');
    }
  };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        (event.target as Element)?.closest(
          'input,textarea,select,[contenteditable="true"],[data-slot="select-trigger"],[data-slot="select-content"]',
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
        <Brand />
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
        <div className="pd-error pd-recovery-error" role="alert">
          <span>{error}</span>
          <Button disabled={busy} variant="outline" onClick={downloadDraft}>
            Download draft
          </Button>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() => setReloadOpen(true)}
          >
            Reload saved version
          </Button>
          {draftDownload ? (
            <a href={draftDownload} download="alltwelve-designer-draft.json">
              Save draft file
            </a>
          ) : null}
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
        <div className={`pd-canvas${tool === 'Pan' ? ' is-panning' : ''}`}>
          <PlayField
            drawing={draft.scene}
            name={draft.name}
            selected={selected}
            heightYards={heightYards}
            zoom={zoom}
            pan={cameraPan}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            guides={guides}
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
                          setRouteId(
                            continuationRoute(draft.scene, player.id, routeId)
                              ?.id ?? '',
                          );
                          setForceNewRoute(false);
                        } else if (route) {
                          setForceNewRoute(false);
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
              {tool === 'Route' && forceNewRoute ? 'New route' : tool}
              {tool === 'Route' ? ' · drag endpoint, release to place' : ''}
            </span>
            {tool === 'Route' ? (
              <Button onClick={finish} size="sm" variant="outline">
                <Check /> Finish route
              </Button>
            ) : null}
          </div>
          <div className="pd-camera-controls" aria-label="Field camera">
            <Button
              aria-label="Zoom out"
              disabled={zoom <= 1}
              onClick={() => changeZoom(zoom / 1.5)}
              size="icon"
              variant="ghost"
            >
              <ZoomOut />
            </Button>
            <output aria-label="Field magnification">
              {Math.round(zoom * 100)}%
            </output>
            <Button
              aria-label="Zoom in"
              disabled={zoom >= 6}
              onClick={() => changeZoom(zoom * 1.5)}
              size="icon"
              variant="ghost"
            >
              <ZoomIn />
            </Button>
            <Button
              aria-label="Pan field"
              aria-pressed={tool === 'Pan'}
              onClick={() => {
                finish();
                setTool(tool === 'Pan' ? 'Select' : 'Pan');
              }}
              size="icon"
              variant="ghost"
            >
              <Hand />
            </Button>
            <Button
              aria-label="Fit field"
              onClick={() => {
                setZoom(1);
                setCameraPan({ x: 0, y: 0 });
              }}
              size="sm"
              variant="ghost"
            >
              Fit
            </Button>
          </div>
          <details className="pd-field-controls">
            <summary>Field settings</summary>
            <div className="pd-field-settings-body">
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
              <WorkspaceSelect
                label="Field depth shown"
                onChange={(value) => {
                  setHeightYards(Number(value));
                  setZoom(1);
                  setCameraPan({ x: 0, y: 0 });
                }}
                value={String(heightYards)}
                options={[
                  { value: '30', label: '30 yards' },
                  { value: '60', label: '60 yards' },
                  { value: '150', label: 'Full field' },
                ]}
              />
            </div>
          </details>
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
                    if (!event.isPrimary || event.button !== 0) return;
                    paletteDrag.current = {
                      pointerId: event.pointerId,
                      start: { x: event.clientX, y: event.clientY },
                      offset: paletteOffset,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const action = paletteDrag.current;
                    if (!action || action.pointerId !== event.pointerId) return;
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
                  onPointerUp={(event) => {
                    if (paletteDrag.current?.pointerId === event.pointerId)
                      paletteDrag.current = null;
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      event.currentTarget.releasePointerCapture(
                        event.pointerId,
                      );
                  }}
                  onPointerCancel={(event) => {
                    if (paletteDrag.current?.pointerId === event.pointerId)
                      paletteDrag.current = null;
                  }}
                  onLostPointerCapture={(event) => {
                    if (paletteDrag.current?.pointerId === event.pointerId)
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
                      setRouteId(
                        continuationRoute(draft.scene, player.id, routeId)
                          ?.id ?? '',
                      );
                      setForceNewRoute(false);
                      setTool('Route');
                    }}
                    size="sm"
                  >
                    <Pencil /> Route
                  </Button>
                ) : route ? (
                  <Button
                    onClick={() => {
                      setForceNewRoute(false);
                      setRouteId(route.id);
                      setAnchorId(route.playerId ?? '');
                      setTool('Route');
                    }}
                    size="sm"
                  >
                    Extend
                  </Button>
                ) : null}
                {player || route?.playerId ? (
                  <Button
                    aria-pressed={forceNewRoute}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAnchorId(player?.id ?? route!.playerId!);
                      setRouteId('');
                      setForceNewRoute(true);
                      setTool('Route');
                    }}
                  >
                    New route
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
                        <WorkspaceSelect
                          id="pd-control-2"
                          label="Player symbol"
                          value={player.symbol ?? 'circle'}
                          onChange={(value) => {
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
                                      symbol: value as
                                        | 'circle'
                                        | 'triangle'
                                        | 'square',
                                    }
                                  : p,
                              ),
                            });
                          }}
                          options={[
                            { value: 'circle', label: 'Circle' },
                            { value: 'triangle', label: 'Triangle' },
                            { value: 'square', label: 'Square' },
                          ]}
                        />
                      </label>
                    </div>
                  ) : null}
                  {route || player ? (
                    <div className="pd-property-row">
                      <label htmlFor="pd-control-3">
                        Line
                        <WorkspaceSelect
                          id="pd-control-3"
                          label="Route line style"
                          value={route?.lineStyle ?? line}
                          onChange={(value) =>
                            changeRoute({
                              lineStyle: value as Route['lineStyle'],
                            })
                          }
                          options={['solid', 'dashed', 'dotted', 'curve'].map(
                            (value) => ({
                              value,
                              label: value[0].toUpperCase() + value.slice(1),
                            }),
                          )}
                        />
                      </label>
                      <label htmlFor="pd-control-4">
                        Ending
                        <WorkspaceSelect
                          id="pd-control-4"
                          label="Route ending"
                          value={route?.ending ?? ending}
                          onChange={(value) =>
                            changeRoute({
                              ending: value as Route['ending'],
                            })
                          }
                          options={[
                            { value: 'arrow', label: 'Arrow' },
                            { value: 'bar', label: 'Block / bar' },
                            { value: 'none', label: 'None' },
                          ]}
                        />
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
                          <WorkspaceSelect
                            id="pd-control-7"
                            label="Coverage shape"
                            value={zone.shape ?? 'ellipse'}
                            onChange={(value) =>
                              changeZone({
                                shape: value as Zone['shape'],
                              })
                            }
                            options={[
                              { value: 'ellipse', label: 'Oval / circle' },
                              { value: 'rectangle', label: 'Rectangle' },
                              { value: 'triangle', label: 'Triangle' },
                            ]}
                          />
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
              Select a player, then drag to place the next route endpoint. New
              route starts a separate branch. Movement snaps to one yard.
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
                  <WorkspaceSelect
                    id="pd-control-11"
                    label="Formation ownership"
                    value={draft.scope}
                    onChange={(value) =>
                      edit({ scope: value as Draft['scope'] })
                    }
                    options={[
                      { value: 'team', label: 'Our team' },
                      { value: 'scout', label: 'Opponent / scout' },
                    ]}
                  />
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
                  <WorkspaceSelect
                    id="pd-control-15"
                    label="Play type"
                    value={draft.family}
                    onChange={(value) =>
                      edit({ family: value as Draft['family'] })
                    }
                    options={Array.from(
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
                    ).map((value) => ({ value, label: value }))}
                  />
                </label>
                <details>
                  <summary>Our formation</summary>
                  <WorkspaceSelect
                    label="Apply our formation"
                    value=""
                    onChange={setPendingFormation}
                    options={[
                      { value: '', label: 'Choose saved alignment…' },
                      ...ownFormations.map((f) => ({
                        value: f.id,
                        label: [f.name, f.packageName]
                          .filter(Boolean)
                          .join(' · '),
                      })),
                    ]}
                  />
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
                  <WorkspaceSelect
                    label="Opponent formation"
                    value={draft.scene.opponentFormationId ?? ''}
                    onChange={(id) => {
                      const look = formations.find((f) => f.id === id);
                      if (!look) return;
                      sceneEdit({
                        ...replaceScenePlayers(
                          draft.scene,
                          formationPlayers(
                            look,
                            draft.scene.fieldPosition,
                            true,
                          ).map((p) => ({ ...p, colour: '#9aa5b1' })),
                          true,
                        ),
                        showOpponent: true,
                        opponentFormationId: look.id,
                      });
                    }}
                    options={[
                      {
                        value: '',
                        label: `Choose a saved ${opponentSide.toLowerCase()} look…`,
                      },
                      ...scoutLooks.map((f) => ({
                        value: f.id,
                        label: [
                          f.scope === 'scout' ? f.opponent : 'Our team',
                          f.name,
                          f.packageName,
                        ]
                          .filter(Boolean)
                          .join(' · '),
                      })),
                    ]}
                  />
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
      <Dialog
        open={reloadOpen}
        onOpenChange={(open) => {
          if (!busy) setReloadOpen(open);
        }}
      >
        <DialogContent className="athlete-dialog">
          <DialogHeader>
            <DialogTitle>
              Replace this draft with the saved version?
            </DialogTitle>
            <DialogDescription>
              Download your draft first if you want to keep it. Reloading
              replaces the drawing, notes and assignments in this editor.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => setReloadOpen(false)}
            >
              Keep editing
            </Button>
            <Button disabled={busy} variant="outline" onClick={downloadDraft}>
              Download draft
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void reloadSaved()}
            >
              {busy ? 'Reloading…' : 'Reload and discard draft'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
                  scene: replaceScenePlayers(
                    draft.scene,
                    formationPlayers(f, draft.scene.fieldPosition),
                  ),
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
