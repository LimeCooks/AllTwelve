'use client';
import { useId, type PointerEvent as ReactPointerEvent } from 'react';
import { inkColour } from '@/lib/print-layout';
import { fieldViewport } from '@/lib/field-camera';
import {
  normalizeDrawing,
  routePath,
  yardY,
  type Drawing,
  type Player,
  type Point,
  type Scene,
} from '@/lib/play-designer';

export function PlayField({
  drawing,
  name,
  selected = '',
  printMode = false,
  viewportOverride,
  heightYards = 60,
  zoom = 1,
  pan = { x: 0, y: 0 },
  onPointerDown,
  onPointerMove,
  onPointerUp,
  guides,
}: {
  drawing: Drawing;
  name: string;
  selected?: string;
  printMode?: boolean;
  viewportOverride?: { x: number; y: number; width: number; height: number };
  heightYards?: number;
  zoom?: number;
  pan?: { x: number; y: number };
  onPointerDown?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<SVGSVGElement>) => void;
  guides?: Point | null;
}) {
  const scene: Scene = normalizeDrawing(drawing);
  const opponentIds = new Set(scene.opponentPlayers.map((player) => player.id));
  const hiddenRoutes = new Set(
    scene.showOpponent
      ? []
      : scene.routes
          .filter((route) => route.playerId && opponentIds.has(route.playerId))
          .map((route) => route.id),
  );
  const uid = useId().replaceAll(':', '');
  const viewport =
    viewportOverride ??
    fieldViewport(yardY(scene.fieldPosition), heightYards, zoom, pan);
  const tone = (colour: string) => (printMode ? inkColour(colour) : colour);
  const marker = (id: string) => `${uid}-${id}`;
  const player = (p: Player, opponent = false) => {
    const active =
      selected === `player:${p.id}` || selected === `opponent:${p.id}`;
    const colour = tone(p.colour ?? (opponent ? '#8794a2' : '#dce5ef'));
    return (
      <g
        className={`pd-player${active ? ' selected' : ''}${opponent ? ' opponent' : ''}`}
        data-kind={opponent ? 'opponent' : 'player'}
        data-id={p.id}
        key={p.id}
        transform={`translate(${p.x} ${p.y})`}
        aria-label={`${opponent ? 'Opponent ' : ''}${p.label}`}
      >
        {active ? (
          <>
            <circle className="pd-selection-pulse" r="13" />
            <circle className="pd-selection-ring" r="11.5" />
          </>
        ) : null}
        {p.symbol === 'triangle' ? (
          <path
            d="M0 -10 L10 8 L-10 8 Z"
            fill={printMode ? '#ffffff' : '#18242e'}
            stroke={colour}
            strokeWidth="1.6"
          />
        ) : p.symbol === 'square' || (!p.symbol && p.kind === 'line') ? (
          <rect
            x="-8"
            y="-8"
            width="16"
            height="16"
            rx="1"
            fill={printMode ? '#ffffff' : '#18242e'}
            stroke={colour}
            strokeWidth="1.6"
          />
        ) : (
          <circle
            r="8.5"
            fill={printMode ? '#ffffff' : '#18242e'}
            stroke={colour}
            strokeWidth="1.6"
          />
        )}
        <text y={p.symbol === 'triangle' ? 4 : 2.6} fill={colour}>
          {p.label}
        </text>
      </g>
    );
  };
  return (
    <svg
      className={printMode ? 'pd-field pd-field-print' : 'pd-field'}
      aria-label={`${name} football diagram`}
      viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
    >
      <title>{name}</title>
      {printMode ? (
        <style>{`.pd-field-print .pd-yard{stroke:#c2cbd3;stroke-width:.8}.pd-field-print .pd-yard.major{stroke:#9aa9b6;stroke-width:1}.pd-field-print .pd-sideline{stroke:#5f7181;stroke-width:1.2}.pd-field-print .pd-hash{stroke:#93a2af;stroke-width:.8}.pd-field-print .pd-number{fill:#5b6d7c;font:700 14px Arial,sans-serif;text-anchor:middle;opacity:.8}.pd-field-print .pd-los{stroke:#536f83;stroke-width:1.4;stroke-dasharray:5 4}.pd-field-print .pd-player text{font:700 8px Arial,sans-serif;text-anchor:middle}.pd-field-print .pd-label{font:600 11px Arial,sans-serif;text-anchor:middle}.pd-field-print .pd-player.opponent{opacity:.7}`}</style>
      ) : null}
      <defs>
        {scene.routes
          .filter((route) => !hiddenRoutes.has(route.id))
          .map((r) => (
            <marker
              key={r.id}
              id={marker(r.id)}
              viewBox="0 0 8 8"
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="4"
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              {r.ending === 'bar' ? (
                <path d="M6 0 L6 8" stroke={tone(r.colour)} strokeWidth="2" />
              ) : (
                <path
                  d="M0 0 L6 4 L0 8"
                  stroke={tone(r.colour)}
                  strokeWidth="1.6"
                  fill="none"
                />
              )}
            </marker>
          ))}
      </defs>
      <rect
        x="0"
        y="-1500"
        width="720"
        height="4500"
        fill={printMode ? '#ffffff' : '#202b34'}
      />
      <rect
        x="35"
        y="-100"
        width="650"
        height="200"
        fill={printMode ? '#f0f3f5' : '#283540'}
      />
      <rect
        x="35"
        y="1200"
        width="650"
        height="200"
        fill={printMode ? '#f0f3f5' : '#283540'}
      />
      {[-100, 1400].map((y) => (
        <line
          key={y}
          x1="35"
          x2="685"
          y1={y}
          y2={y}
          className="pd-yard major"
        />
      ))}
      {[35, 685].map((x) => (
        <line
          key={x}
          x1={x}
          x2={x}
          y1="-100"
          y2="1400"
          className="pd-sideline"
        />
      ))}
      {Array.from({ length: 111 }, (_, yard) => {
        const y = yardY(yard);
        const label =
          yard === 55
            ? 'C'
            : yard % 10 === 0
              ? `${Math.min(yard, 110 - yard) || 'G'}`
              : '';
        return (
          <g key={yard}>
            {yard % 5 === 0 ? (
              <line
                x1="35"
                x2="685"
                y1={y}
                y2={y}
                className={
                  yard % 10 === 0 || yard === 55 ? 'pd-yard major' : 'pd-yard'
                }
              />
            ) : null}
            {[95, 625, 275, 445].map((x) => (
              <line
                key={x}
                x1={x - 2.5}
                x2={x + 2.5}
                y1={y}
                y2={y}
                className="pd-hash"
              />
            ))}
            {label ? (
              <>
                <text className="pd-number" x="65" y={y - 6}>
                  {label}
                </text>
                <text className="pd-number" x="655" y={y - 6}>
                  {label}
                </text>
                {yard > 0 && yard < 110 && yard !== 55
                  ? [65, 655].map((x) => (
                      <path
                        key={x}
                        className="pd-direction-arrow"
                        fill="#8193a2"
                        d={
                          yard < 55
                            ? `M${x - 3} ${y - 22} L${x + 3} ${y - 22} L${x} ${y - 27} Z`
                            : `M${x - 3} ${y + 4} L${x + 3} ${y + 4} L${x} ${y + 9} Z`
                        }
                      />
                    ))
                  : null}
              </>
            ) : null}
          </g>
        );
      })}
      <line
        x1="35"
        x2="685"
        y1={yardY(scene.fieldPosition)}
        y2={yardY(scene.fieldPosition)}
        className="pd-los"
      />
      {scene.zones
        .filter((zone) => !zone.routeId || !hiddenRoutes.has(zone.routeId))
        .map((z) => (
          <g
            key={z.id}
            data-kind="zone"
            data-id={z.id}
            className={
              selected === `zone:${z.id}` ? 'pd-zone selected' : 'pd-zone'
            }
            transform={`rotate(${z.rotation ?? 0} ${z.x + z.width / 2} ${z.y + z.height / 2})`}
          >
            {z.shape === 'rectangle' ? (
              <rect
                x={z.x}
                y={z.y}
                width={z.width}
                height={z.height}
                fill={tone(z.colour)}
                fillOpacity={z.opacity ?? 0.25}
                stroke={tone(z.colour)}
                strokeWidth="1"
              />
            ) : z.shape === 'triangle' ? (
              <path
                d={`M${z.x + z.width / 2} ${z.y} L${z.x + z.width} ${z.y + z.height} L${z.x} ${z.y + z.height} Z`}
                fill={tone(z.colour)}
                fillOpacity={z.opacity ?? 0.25}
                stroke={tone(z.colour)}
                strokeWidth="1"
              />
            ) : (
              <ellipse
                cx={z.x + z.width / 2}
                cy={z.y + z.height / 2}
                rx={z.width / 2}
                ry={z.height / 2}
                fill={tone(z.colour)}
                fillOpacity={z.opacity ?? 0.25}
                stroke={tone(z.colour)}
                strokeWidth="1"
              />
            )}
            {selected === `zone:${z.id}` ? (
              <g>
                <rect
                  x={z.x - 3}
                  y={z.y - 3}
                  width={z.width + 6}
                  height={z.height + 6}
                  fill="none"
                  stroke="#f4f7fa"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                {[
                  { x: z.x + z.width, y: z.y + z.height / 2 },
                  { x: z.x + z.width / 2, y: z.y + z.height },
                ].map((p, index) => (
                  <rect
                    key={index}
                    data-kind="resize"
                    data-id={z.id}
                    data-index={index}
                    x={p.x - (index === 0 ? 3 : 9)}
                    y={p.y - (index === 0 ? 9 : 3)}
                    width={index === 0 ? 6 : 18}
                    height={index === 0 ? 18 : 6}
                    rx="2"
                    fill="#f4f7fa"
                    stroke={tone(z.colour)}
                    strokeWidth="1"
                    style={{ cursor: index === 0 ? 'ew-resize' : 'ns-resize' }}
                  />
                ))}
              </g>
            ) : null}
          </g>
        ))}
      {scene.routes
        .filter((route) => !hiddenRoutes.has(route.id))
        .map((r) => {
          const points = r.points?.length
            ? r.points
            : [
                { x: r.startX, y: r.startY },
                { x: r.endX, y: r.endY },
              ];
          const path = routePath(r);
          return (
            <g key={r.id} data-kind="route" data-id={r.id}>
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth="12"
              />
              <path
                d={path}
                fill="none"
                stroke={tone(r.colour)}
                strokeWidth={selected === `route:${r.id}` ? 2.3 : 1.7}
                strokeDasharray={
                  r.lineStyle === 'dashed'
                    ? '6 4'
                    : r.lineStyle === 'dotted'
                      ? '1 4'
                      : undefined
                }
                strokeLinecap="round"
                strokeLinejoin={r.lineStyle === 'curve' ? 'round' : 'miter'}
                markerEnd={
                  r.ending === 'none' ? undefined : `url(#${marker(r.id)})`
                }
              />
              {selected === `route:${r.id}`
                ? points
                    .slice(1)
                    .map((p, i) => (
                      <circle
                        key={i}
                        data-kind="vertex"
                        data-id={r.id}
                        data-index={i + 1}
                        cx={p.x}
                        cy={p.y}
                        r="4"
                        fill="#f3f7fb"
                        stroke={tone(r.colour)}
                        strokeWidth="1.5"
                      />
                    ))
                : null}
            </g>
          );
        })}
      {scene.showOpponent
        ? scene.opponentPlayers.map((p) => player(p, true))
        : null}
      {scene.players.map((p) => player(p))}
      {scene.labels.map((l) => (
        <text
          data-kind="label"
          data-id={l.id}
          key={l.id}
          x={l.x}
          y={l.y}
          fill={tone(l.colour)}
          className={
            selected === `label:${l.id}` ? 'pd-label selected' : 'pd-label'
          }
        >
          {l.text}
        </text>
      ))}
      {guides && !printMode ? (
        <g
          className="pd-alignment-guides"
          aria-hidden="true"
          pointerEvents="none"
        >
          <line
            x1={viewport.x}
            x2={viewport.x + viewport.width}
            y1={guides.y}
            y2={guides.y}
          />
          <line
            x1={guides.x}
            x2={guides.x}
            y1={viewport.y}
            y2={viewport.y + viewport.height}
          />
          <circle cx={guides.x} cy={guides.y} r="3" />
        </g>
      ) : null}
    </svg>
  );
}
