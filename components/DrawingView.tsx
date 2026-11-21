'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MEASURABLE,
  dimLabel,
  dimSVG,
  distToArc,
  fmtMM,
  nearestOnEdge,
  snapPoints,
  viewArcs,
  type Arc,
  type Snap,
  toModel,
  toPaper,
  viewAt,
  type Dim,
  type DrawingData,
  type Pt,
  type SheetView,
} from '@/lib/sheet';
import { DiameterIcon, LinearIcon, PanelButton, RadiusIcon, RedoIcon, RemoveIcon, SelectIcon, UndoIcon } from './icons';
import { CARD_SPACE, IsoGrid, ZoomControl, clampZoom } from './Preview';
import { Chevron } from './icons';
import { useViewport } from './useViewport';
import { Menu } from './ui';

type Tool = 'select' | 'linear' | 'diameter' | 'radius';
type MView = Exclude<keyof DrawingData['views'], 'iso'>;
const VIEW_NAME: Record<MView, string> = { front: 'Front', top: 'Top', right: 'Right' };
const SNAP_PX = 10; // snap radius on screen

/** Kind and offset of a linear dimension from its two paper points and the cursor (CAD-like):
 *  pull straight out from a slanted edge (within 25° of its normal) → along the edge; otherwise
 *  pulling up/down → horizontal, left/right → vertical. */
function placement(A: Pt, B: Pt, C: Pt): { kind: Dim['kind']; offset: number } {
  const [x0, x1] = [Math.min(A[0], B[0]), Math.max(A[0], B[0])];
  const [y0, y1] = [Math.min(A[1], B[1]), Math.max(A[1], B[1])];
  const flatX = x1 - x0 < 1e-6, flatY = y1 - y0 < 1e-6;
  const side = (v: number, lo: number, hi: number) => {
    const o = v >= (lo + hi) / 2 ? v - hi : v - lo;
    return Math.abs(o) < 2 ? (o >= 0 ? 2 : -2) : o;
  };
  const ex = B[0] - A[0], ey = B[1] - A[1], EL = Math.hypot(ex, ey) || 1;
  const vx = C[0] - (A[0] + B[0]) / 2, vy = C[1] - (A[1] + B[1]) / 2, VL = Math.hypot(vx, vy) || 1;
  const alongNormal = Math.abs((vx * -ey + vy * ex) / (EL * VL)) > Math.cos((25 * Math.PI) / 180);
  let kind: Dim['kind'];
  if (flatY) kind = 'h';
  else if (flatX) kind = 'v';
  else if (alongNormal) kind = 'aligned';
  else kind = Math.abs(vy) >= Math.abs(vx) ? 'h' : 'v';
  if (kind === 'h') return { kind, offset: side(C[1], y0, y1) };
  if (kind === 'v') return { kind, offset: side(C[0], x0, x1) };
  const ux = B[0] - A[0], uy = B[1] - A[1], L = Math.hypot(ux, uy) || 1;
  const o = ((C[0] - A[0]) * -uy + (C[1] - A[1]) * ux) / L;
  return { kind, offset: Math.abs(o) < 2 ? (o >= 0 ? 2 : -2) : o };
}

function ToolButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-[30px] items-center gap-1.5 rounded-lg border-[1.5px] px-2.5 text-[12px] ${
        active ? 'border-accent font-medium text-fg' : 'border-transparent text-fg-2 hover:bg-fill/60 hover:text-fg'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export default function DrawingView({
  drawing,
  sheetSvg,
  loading,
  error,
  notice,
  cells,
  focusedField,
  onFieldClick,
  dims,
  selectedDim,
  onSelectDim,
  onAddDim,
  onRemoveDim,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  fileKey,
  onShowPanel,
  components,
  component,
  onComponent,
}: {
  drawing: DrawingData | null;
  sheetSvg: string | null;
  loading: boolean;
  error: string | null;
  notice: string | null;
  cells: Record<string, [number, number, number, number]>;
  focusedField: string | null;
  onFieldClick: (id: string) => void;
  dims: Dim[];
  selectedDim: string | null;
  onSelectDim: (id: string | null) => void;
  onAddDim: (d: Dim) => void;
  onRemoveDim: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  fileKey: string | null;
  onShowPanel?: () => void;
  components?: { key: string; label: string }[] | null;
  component?: string;
  onComponent?: (key: string) => void;
}) {
  const [compMenu, setCompMenu] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---------- fit the sheet into the free area (left of the side card), then zoom/pan by CSS transform
  const W = drawing?.sheet.w ?? 297, H = drawing?.sheet.h ?? 210;
  const freeW = Math.max(1, size.w - CARD_SPACE);
  const top = components ? 120 : 80, bottom = 48, side = 48; // room for the toolbar (and the component picker)
  const k = Math.max(0.1, Math.min((freeW - 2 * side) / W, (size.h - top - bottom) / H)); // px per mm
  const sw = W * k, sh = H * k;
  const left = (freeW - sw) / 2, y = top + (size.h - top - bottom - sh) / 2;

  const { layer, zv, moving, zoomAt, panBy, fit, end: endGesture, transform } = useViewport(clampZoom);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: number; placing: boolean } | null>(null);
  useEffect(() => fit(), [fileKey, W, H]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  // ---------- dimension tools
  const [tool, setTool] = useState<Tool>('select');
  const [first, setFirst] = useState<{ view: MView; pt: Pt } | null>(null); // linear: first point
  const [second, setSecond] = useState<Pt | null>(null); // linear: second point → placing
  const [cursor, setCursor] = useState<Pt | null>(null); // paper mm
  const [hoverSnap, setHoverSnap] = useState<{ view: MView; pt: Pt; kind: Snap['kind'] } | null>(null);
  const [hoverArc, setHoverArc] = useState<{ view: MView; arc: Arc } | null>(null);

  const snaps = useMemo(() => {
    const out: Partial<Record<MView, Snap[]>> = {};
    if (drawing) for (const n of MEASURABLE) if (drawing.views[n]) out[n] = snapPoints(drawing.views[n]!);
    return out;
  }, [drawing]);

  const resetTool = () => {
    setFirst(null);
    setSecond(null);
    setHoverSnap(null);
    setHoverArc(null);
  };
  useEffect(resetTool, [drawing, tool]);

  /** Client px → paper mm, and the paper size of one screen pixel. */
  const paperAt = (cx: number, cy: number): { P: Pt; px: number } | null => {
    const r = sheetRef.current?.getBoundingClientRect();
    if (!r || !r.width) return null;
    return { P: [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H], px: W / r.width };
  };
  /** Snap: the nearest feature point (end, corner, midpoint, centre); otherwise the nearest point on an
   *  edge, so anything can be measured. */
  const nearestSnap = (P: Pt, px: number, only?: MView): { view: MView; pt: Pt; kind: Snap['kind'] } | null => {
    if (!drawing) return null;
    const view = only ?? viewAt(drawing, P);
    if (!view || !snaps[view]) return null;
    const v = drawing.views[view]!;
    let best: Snap | null = null, bd = SNAP_PX * px;
    for (const s of snaps[view]!) {
      const q = toPaper(v, s.pt), d = Math.hypot(q[0] - P[0], q[1] - P[1]);
      if (d < bd) [best, bd] = [s, d];
    }
    if (best) return { view, ...(best as Snap) };
    const e = nearestOnEdge(v, toModel(v, P));
    return e && e.d * v.sc < 0.6 * SNAP_PX * px ? { view, pt: e.pt, kind: 'edge' } : null;
  };
  /** Arc or circle under the cursor (fitted to the drawn edges, so not-quite-perfect circles work). */
  const nearestArc = (P: Pt, px: number) => {
    if (!drawing) return null;
    const view = viewAt(drawing, P);
    if (!view) return null;
    const v = drawing.views[view]!;
    const m = toModel(v, P);
    let best: Arc | null = null, bd = (SNAP_PX * px) / v.sc;
    for (const a of viewArcs(v)) {
      const d = distToArc(a, m);
      if (d < bd) [best, bd] = [a, d];
    }
    return best ? { view, arc: best as Arc } : null;
  };

  /** The linear dimension being placed (follows the cursor). */
  const placing: Dim | null = useMemo(() => {
    if (!drawing || tool !== 'linear' || !first || !second || !cursor) return null;
    const v = drawing.views[first.view]!;
    const { kind, offset } = placement(toPaper(v, first.pt), toPaper(v, second), cursor);
    return { id: 'placing', view: first.view, kind, a: first.pt, b: second, offset };
  }, [drawing, tool, first, second, cursor]);

  const commitPlacing = () => {
    if (!placing) return;
    onAddDim({ ...placing, id: `dim-${Date.now().toString(36)}` });
    resetTool();
  };

  const toolClick = (cx: number, cy: number) => {
    const at = paperAt(cx, cy);
    if (!drawing || !at) return;
    if (tool === 'select') {
      const el = document.elementFromPoint(cx, cy);
      const field = el?.closest('[data-field]')?.getAttribute('data-field');
      if (field) return onFieldClick(field);
      // Dimension lines are 0.13 mm: hit-test their boxes (grown by 1.5 mm), smallest first
      let hit: string | null = null, area = Infinity;
      sheetRef.current?.querySelectorAll<SVGGElement>('[data-dim]').forEach((g) => {
        const b = g.getBBox(), m = 1.5;
        if (at.P[0] >= b.x - m && at.P[0] <= b.x + b.width + m && at.P[1] >= b.y - m && at.P[1] <= b.y + b.height + m) {
          const a = (b.width + 2 * m) * (b.height + 2 * m);
          if (a < area) [hit, area] = [g.getAttribute('data-dim'), a];
        }
      });
      onSelectDim(hit);
      return;
    }
    if (tool === 'linear') {
      if (second) return commitPlacing();
      const s = nearestSnap(at.P, at.px, first?.view);
      if (!s) return;
      if (!first) setFirst({ view: s.view, pt: s.pt });
      else if (Math.hypot(s.pt[0] - first.pt[0], s.pt[1] - first.pt[1]) > 1e-6) setSecond(s.pt);
      return;
    }
    const hit = nearestArc(at.P, at.px);
    if (!hit) return;
    const v = drawing.views[hit.view]!;
    const { cx: acx, cy: acy, r } = hit.arc;
    const c = toPaper(v, [acx, acy]);
    const ang = Math.atan2(-(at.P[1] - c[1]), at.P[0] - c[0]);
    onAddDim({ id: `dim-${Date.now().toString(36)}`, view: hit.view, kind: tool, a: [acx, acy], b: [r, ang], offset: 3 });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, placing: !!second };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!second) setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d0 = drag.current;
    // While panning, only move the layer: no hover/snap work and no re-render
    const at = d0 && !d0.placing && d0.moved >= 4 ? null : tool === 'select' && !d0 ? null : paperAt(e.clientX, e.clientY);
    if (at) {
      setCursor(at.P);
      if (tool === 'linear' && !second) setHoverSnap(nearestSnap(at.P, at.px, first?.view));
      if (tool === 'diameter' || tool === 'radius') setHoverArc(nearestArc(at.P, at.px));
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (!d.placing && d.moved >= 4) panBy(dx, dy);
  };
  const endPointer = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setPanning(false);
    endGesture();
    if (e.type !== 'pointerup') return;
    if (d.placing) return commitPlacing(); // drag (or click) to place
    if (d.moved < 4) toolClick(e.clientX, e.clientY);
  };

  // Keys: Esc cancels / deselects, Backspace/Delete removes the selected dimension
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'Escape') {
        if (first) resetTool();
        else onSelectDim(null);
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && selectedDim) {
        e.preventDefault();
        onRemoveDim(selectedDim);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // ---------- overlay (not part of the download): selection, snapping, the dimension being placed
  const accent = 'var(--t-accent)';
  const overlay: string[] = [];
  const hl = focusedField ? cells[focusedField] : undefined;
  if (drawing) {
    const sel = dims.find((d) => d.id === selectedDim);
    if (sel) overlay.push(dimSVG(drawing, sel, accent, accent));
    // marker sizes in screen px, whatever the zoom
    const pxmm = Math.max(1e-6, (sw / W) * zv.z); // screen px per paper mm
    const R = (px: number) => (px / pxmm).toFixed(3);
    const mark = (view: MView, p: Pt, kind: Snap['kind'] | 'picked') => {
      const q = toPaper(drawing.views[view] as SheetView, p);
      if (kind === 'edge') {
        const h = +R(3.5);
        overlay.push(`<rect x="${q[0] - h}" y="${q[1] - h}" width="${2 * h}" height="${2 * h}" fill="none" stroke="${accent}" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
      } else if (kind === 'centre') {
        const h = +R(4.5);
        overlay.push(`<path d="M${q[0] - h} ${q[1]}H${q[0] + h}M${q[0]} ${q[1] - h}V${q[1] + h}" stroke="${accent}" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
      } else {
        overlay.push(`<circle cx="${q[0]}" cy="${q[1]}" r="${R(kind === 'picked' ? 3 : 3.5)}" fill="${kind === 'picked' ? accent : 'none'}" stroke="${accent}" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
      }
    };
    // While measuring, the snap points near the cursor are shown faintly, so you can see what to pick
    if (tool === 'linear' && !second && cursor) {
      const view = first?.view ?? viewAt(drawing, cursor);
      const v = view && drawing.views[view];
      if (view && v && snaps[view]) {
        const near = snaps[view]!.filter((s) => {
          const q = toPaper(v, s.pt);
          return Math.hypot(q[0] - cursor[0], q[1] - cursor[1]) * pxmm < 70;
        });
        for (const s of near.slice(0, 60)) {
          const q = toPaper(v, s.pt);
          overlay.push(`<circle cx="${q[0]}" cy="${q[1]}" r="${R(2)}" fill="${accent}" fill-opacity="0.35"/>`);
        }
      }
    }
    if (first) mark(first.view, first.pt, 'picked');
    if (second && first) mark(first.view, second, 'picked');
    if (hoverSnap) mark(hoverSnap.view, hoverSnap.pt, hoverSnap.kind);
    if (placing) overlay.push(dimSVG(drawing, placing, accent, accent));
    if (hoverArc) {
      // highlight exactly the edge that will be measured, thin
      const v = drawing.views[hoverArc.view]!;
      const d = 'M' + hoverArc.arc.pts.map((p) => toPaper(v, p).map((n) => n.toFixed(3)).join(' ')).join('L');
      overlay.push(`<path d="${d}" fill="none" stroke="${accent}" stroke-width="1.25" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`);
      const c = toPaper(v, [hoverArc.arc.cx, hoverArc.arc.cy]), h = +R(4.5);
      overlay.push(`<path d="M${c[0] - h} ${c[1]}H${c[0] + h}M${c[0]} ${c[1] - h}V${c[1] + h}" stroke="${accent}" stroke-width="1" vector-effect="non-scaling-stroke"/>`);
    }
  }
  const arcLabel = hoverArc && (tool === 'diameter' ? 'Ø' + fmtMM(2 * hoverArc.arc.r) : 'R' + fmtMM(hoverArc.arc.r));
  const chipText = placing ? dimLabel(placing) : arcLabel;
  const chip = chipText && cursor ? { label: chipText, x: left + (cursor[0] / W) * sw, y: y + (cursor[1] / H) * sh } : null;
  const listed = drawing ? dims.filter((d) => drawing.views[d.view]) : [];

  return (
    <main className="relative h-full min-w-0 flex-1 overflow-hidden bg-bg">
      <IsoGrid />
      <div
        ref={stageRef}
        className={`absolute inset-0 touch-none select-none ${
          tool !== 'select' ? 'cursor-crosshair' : panning ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={() => {
          setHoverSnap(null);
          setHoverArc(null);
          setCursor(null);
        }}
      >
        <div ref={layer} className="absolute inset-0 origin-top-left" style={{ transform }}>
          {sheetSvg && size.w > 0 && (
            <div
              ref={sheetRef}
              className={`absolute bg-white shadow-[0_0_1px_1px_rgb(0_0_0/0.06),0_6px_24px_rgb(0_0_0/0.1)] transition-opacity duration-150 ${loading ? 'opacity-60' : ''}`}
              style={{ left, top: y, width: sw, height: sh }}
            >
              <div className="size-full [&>svg]:block [&>svg]:size-full [&_[data-field]]:cursor-text" dangerouslySetInnerHTML={{ __html: sheetSvg }} />
              <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${W} ${H}`} aria-hidden>
                {hl && (
                  <rect
                    x={hl[0]}
                    y={hl[1]}
                    width={hl[2]}
                    height={hl[3]}
                    fill="color-mix(in srgb, var(--t-accent) 10%, transparent)"
                    stroke={accent}
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
                <g dangerouslySetInnerHTML={{ __html: overlay.join('') }} />
              </svg>
            </div>
          )}
          {chip && !moving && (
            <div
              className="pointer-events-none absolute rounded bg-accent px-1.5 py-[3px] text-[11px] font-medium text-on-accent"
              style={{ left: chip.x + 12, top: chip.y - 10 }}
            >
              {chip.label}
            </div>
          )}
        </div>
        {!sheetSvg && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center text-[13px] text-fg-3" style={{ right: CARD_SPACE }}>
            Drawing views…
          </div>
        )}
      </div>

      {/* Toolbar: tools | undo, redo | zoom */}
      <div className="absolute top-6 left-6 flex items-center gap-2">
        {onShowPanel && <PanelButton onClick={onShowPanel} label="Show panel" />}
        <div className="flex items-center gap-0.5 rounded-[10px] border border-border bg-surface p-0.5">
          <ToolButton active={tool === 'select'} onClick={() => setTool('select')} icon={<SelectIcon />} label="Select" />
          <ToolButton active={tool === 'linear'} onClick={() => setTool('linear')} icon={<LinearIcon />} label="Linear" />
          <ToolButton active={tool === 'diameter'} onClick={() => setTool('diameter')} icon={<DiameterIcon />} label="Diameter" />
          <ToolButton active={tool === 'radius'} onClick={() => setTool('radius')} icon={<RadiusIcon />} label="Radius" />
          <span className="mx-0.5 h-[18px] w-px bg-border" aria-hidden />
          <button type="button" onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" className="flex h-[30px] items-center rounded-lg px-2 text-fg-2 hover:bg-fill/60 hover:text-fg disabled:opacity-40">
            <UndoIcon />
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" className="flex h-[30px] items-center rounded-lg px-2 text-fg-2 hover:bg-fill/60 hover:text-fg disabled:opacity-40">
            <RedoIcon />
          </button>
        </div>
        <ZoomControl zoom={zv.z} onZoomIn={() => zoomAt(1.25, freeW / 2, size.h / 2)} onZoomOut={() => zoomAt(1 / 1.25, freeW / 2, size.h / 2)} onFit={fit} />
      </div>

      {/* Assemblies: which component the drawing shows */}
      {components && onComponent && (
        <div className="absolute top-[68px] left-6">
          <button
            type="button"
            onClick={() => setCompMenu((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={compMenu}
            className="flex h-[34px] max-w-[320px] items-center gap-2 rounded-lg border border-border bg-surface pr-2.5 pl-3 text-[13px] font-medium hover:border-fg-3 hover:bg-surface-hover"
          >
            <span className="truncate">{components.find((c) => c.key === component)?.label ?? 'Whole assembly'}</span>
            <Chevron className="shrink-0 text-fg-2" />
          </button>
          {compMenu && (
            <Menu
              className="top-10 left-0 max-h-[60vh] overflow-y-auto"
              items={components.map((c) => ({ key: c.key, label: c.label }))}
              active={component}
              onSelect={(k) => {
                onComponent(k);
                setCompMenu(false);
              }}
              onClose={() => setCompMenu(false)}
            />
          )}
        </div>
      )}

      {/* Dimensions: one row per dimension (value · view · ×) */}
      <div className="absolute top-6 right-6 flex max-h-[calc(100%-48px)] w-[248px] flex-col gap-0.5 overflow-y-auto rounded-[10px] border border-border bg-surface px-2.5 py-3">
        <h2 className="px-1.5 pb-1.5 text-[13px] font-medium">Dimensions</h2>
        {listed.map((d) => (
          <div
            key={d.id}
            onClick={() => onSelectDim(d.id === selectedDim ? null : d.id)}
            className={`flex h-[30px] shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-1.5 ${d.id === selectedDim ? 'bg-accent/14' : 'hover:bg-fill/40'}`}
          >
            <span className="w-[52px] text-[13px] font-medium">{dimLabel(d)}</span>
            <span className="flex-1 text-[12px] text-fg-2">{VIEW_NAME[d.view]}</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveDim(d.id);
              }}
              aria-label={`Remove ${dimLabel(d)}`}
              className="flex size-5 items-center justify-center rounded text-fg-3 hover:text-accent"
            >
              <RemoveIcon />
            </button>
          </div>
        ))}
        {placing && (
          <div className="flex h-[30px] shrink-0 items-center gap-2.5 rounded-md border border-dashed border-accent px-1.5 text-accent">
            <span className="w-[52px] text-[13px] font-medium">{dimLabel(placing)}</span>
            <span className="flex-1 text-[12px]">{VIEW_NAME[placing.view]}</span>
          </div>
        )}
      </div>

      {(loading || notice) && sheetSvg && (
        <div
          className="pointer-events-none absolute bottom-6 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-fg-2"
          style={{ left: `calc((100% - ${CARD_SPACE}px) / 2)` }}
        >
          <span className={`size-1.5 rounded-full bg-accent ${loading ? 'animate-pulse' : ''}`} />
          {loading ? 'Drawing views…' : notice}
        </div>
      )}
      {error && (
        <div role="alert" className="absolute bottom-6 left-1/2 z-50 flex max-w-[480px] -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-fg-2 shadow-menu">
          <span className="size-2 shrink-0 rounded-full bg-axis-x" />
          {error}
        </div>
      )}
    </main>
  );
}
