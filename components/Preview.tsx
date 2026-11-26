'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AXIS_COLOR, VIEWS, cameraVectors, type Rot, type View } from '@/lib/views';
import { Chevron, CubeIcon, FitIcon, MinusIcon, PanelButton, PlusIcon, RedoIcon, UndoIcon } from './icons';
import OrientationCard from './OrientationCard';
import { Menu } from './ui';
import { useViewport } from './useViewport';
import LayoutCard from './LayoutCard';
import { backingSize, drawFill, drawProjectedFill, fillColours, fillPartAt, fitBox, placeholderFrame, projectFill, projectedPartAt, splitFill, svgFrame, type FillMesh } from '@/lib/lightFill';
import { GLFill } from '@/lib/glFill';

/** Orientation card (248) + its 24 px inset + 24 px gap. The model is centred left of this. */
export const CARD_SPACE = 248 + 24 + 24;
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

export type PartAction = 'isolate' | 'unisolate' | 'hide' | 'select' | 'download' | 'showAll';

/** Iso grid: two line families at ±30°, 34 px apart (perpendicular). One tile is 68 × 39.26 px. */
export function IsoGrid() {
  const w = 68, h = 34 / Math.cos(Math.PI / 6);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <svg className="absolute inset-0 size-full">
        <defs>
          <pattern id="iso-grid" width={w} height={h} patternUnits="userSpaceOnUse">
            <path d={`M0 0L${w} ${h}M0 ${h}L${w} 0`} stroke="var(--t-grid)" strokeWidth="1" fill="none" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#iso-grid)" />
      </svg>
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,var(--color-bg)_0%,transparent_45%)]" />
    </div>
  );
}

/** Empty state. Hover: dashed border + button turn accent. File dragged over: solid accent border. */
function DropZone({ dragging, busy, fileName, onBrowse }: { dragging: boolean; busy: boolean; fileName?: string; onBrowse: () => void }) {
  const t = 'transition-colors duration-[140ms] ease-out';
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      {/* The whole box opens the file picker, not only the button */}
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label="Browse for a STEP file"
        aria-disabled={busy}
        onClick={() => !busy && onBrowse()}
        onKeyDown={(e) => {
          if (!busy && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            onBrowse();
          }
        }}
        className={`group relative flex h-[360px] w-full max-w-[560px] flex-col items-center justify-center gap-2.5 rounded-[14px] ${t} ${
          dragging ? 'bg-accent/6' : 'bg-surface/60'
        } ${busy ? 'cursor-progress' : 'cursor-pointer'}`}
      >
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
          <rect
            x="0.75"
            y="0.75"
            rx="14"
            style={{ width: 'calc(100% - 1.5px)', height: 'calc(100% - 1.5px)', transition: 'stroke 140ms ease-out' }}
            fill="none"
            strokeWidth={dragging ? 1.5 : 1.2}
            strokeDasharray={dragging ? undefined : '6 6'}
            className={dragging ? 'stroke-accent' : busy ? 'stroke-fg-3' : 'stroke-fg-3 group-hover:stroke-accent'}
          />
        </svg>
        <CubeIcon className={`${t} ${dragging ? 'text-accent' : 'text-fg'} ${busy ? 'animate-pulse' : ''}`} />
        <p className={`text-[18px] font-medium ${t} ${dragging ? 'text-accent' : ''}`}>
          {dragging ? 'Release to open' : busy ? `Reading ${fileName ?? 'file'}…` : 'Drop a STEP file here'}
        </p>
        <p className="text-[12px] text-fg-3">
          {dragging ? 'STEP file detected' : busy ? 'Loading the geometry can take a few seconds' : '.step or .stp — single part or assembly'}
        </p>
        {!dragging && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation(); // the box handles it; don't open the picker twice
              onBrowse();
            }}
            disabled={busy}
            className={`rounded-lg bg-fill px-3.5 py-2 text-[13px] font-medium ${t} group-hover:bg-accent group-hover:text-on-accent disabled:opacity-40 group-hover:disabled:bg-fill group-hover:disabled:text-fg`}
          >
            Browse files
          </button>
        )}
      </div>
    </div>
  );
}

const toolBtn =
  'flex h-7 w-[30px] items-center justify-center rounded-md text-fg-2 hover:bg-fill hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-fg-2';

export function ZoomControl({ zoom, onZoomIn, onZoomOut, onFit }: { zoom: number; onZoomIn: () => void; onZoomOut: () => void; onFit: () => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-[10px] border border-border bg-surface px-1 py-0.5">
      <button type="button" className={toolBtn} onClick={onZoomOut} disabled={zoom <= ZOOM_MIN + 1e-6} aria-label="Zoom out" title="Zoom out">
        <MinusIcon />
      </button>
      <span className="flex h-7 w-11 items-center justify-center text-[12px] font-medium text-fg-2 tabular-nums" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <button type="button" className={toolBtn} onClick={onZoomIn} disabled={zoom >= ZOOM_MAX - 1e-6} aria-label="Zoom in" title="Zoom in">
        <PlusIcon />
      </button>
      <span className="h-[18px] w-px bg-border" aria-hidden />
      <button type="button" className={toolBtn} onClick={onFit} aria-label="Fit: 100% and centre" title="Fit (100%, centred)">
        <FitIcon />
      </button>
    </div>
  );
}

export default function Preview({
  hasModel,
  fileName,
  loadingName,
  dragging,
  svg,
  rendering,
  preparing,
  message,
  error,
  view,
  onView,
  rot,
  step,
  onRotate,
  onStep,
  onReset,
  onBrowse,
  selectable,
  selected,
  isolated,
  partName,
  onSelect,
  onPartAction,
  isolationLabel,
  isolationAction,
  onIsolationAction,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onShowPanel,
  fillMesh,
  parts,
  gpuOnly,
  offsets,
  stale,
  layout,
  onLayout,
  onSpread,
  onResetLayout,
  onDragPart,
}: {
  /** Exploded view: part index → [dx, dy, dz] model mm. */
  offsets?: Record<number, number[]>;
  /** The drawing on screen is not the one wanted (angle or layout changed): show the GPU lines. */
  stale?: boolean;
  /** Assemblies: the Layout card (Assembled / Exploded + spread). */
  layout?: { mode: 'assembled' | 'exploded'; spread: number } | null;
  onLayout?: (m: 'assembled' | 'exploded') => void;
  onSpread?: (s: number) => void;
  onResetLayout?: () => void;
  /** Exploded: drag a part; delta in model mm. */
  onDragPart?: (part: number, delta: number[]) => void;
  /** Very heavy models: no exact SVG while rotating, the GPU lines are the preview (exact on download). */
  gpuOnly?: boolean;
  fillMesh?: FillMesh | null;
  /** The parts being drawn (for the silhouette shown while a new angle is computed). */
  parts?: number[] | null;
  hasModel: boolean;
  fileName: string | null;
  loadingName: string | null;
  dragging: boolean;
  svg: string | null;
  rendering: boolean;
  preparing: string | null;
  message: string | null;
  error: string | null;
  view: View;
  onView: (v: View) => void;
  rot: Rot;
  step: number;
  onRotate: (axis: number, delta: number) => void;
  onStep: (s: number) => void;
  onReset: () => void;
  onBrowse: () => void;
  selectable: boolean;
  selected: number | null;
  isolated: number | null;
  partName: (i: number) => string;
  onSelect: (i: number | null) => void;
  onPartAction: (a: PartAction, i: number) => void;
  isolationLabel: string | null;
  isolationAction: string;
  onIsolationAction: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onShowPanel?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const label = VIEWS.find((v) => v.id === view)!.label;

  // ---------- stage size (the model is centred in the free area left of the orientation card)
  const stageRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasModel]);
  const freeW = Math.max(1, size.w - CARD_SPACE);

  // ---------- zoom + pan: CSS transform of the drawing, never re-rendered by the backend
  const { layer, zv, moving, zoomAt, panBy, fit, end: endGesture, transform } = useViewport(clampZoom);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);
  const [tag, setTag] = useState<{ x: number; y: number } | null>(null);
  const [ctx, setCtx] = useState<{ i: number; x: number; y: number } | null>(null);


  // New file, or another view / isolation → back to 100 %, centred
  useEffect(() => fit(), [fileName, view, isolated]);
  useEffect(() => setCtx(null), [fileName, view, rot, svg]);

  // ---------- light preview: lines stay SVG, the fill is a canvas bitmap (see lib/lightFill)
  const want = useMemo(() => cameraVectors(view, rot), [view, rot]);
  // GPU-only preview: the frame comes from the mesh at the wanted angle, there is no SVG
  const gpuPh = useMemo(
    () => (gpuOnly && fillMesh && parts?.length ? placeholderFrame(fillMesh, want, new Set(parts), offsets) : null),
    [gpuOnly, fillMesh, parts, want, offsets],
  );
  const light = useMemo(() => (gpuPh ? { html: '', parts: [], vb: gpuPh.vb } : svg ? splitFill(svg) : null), [gpuPh, svg]);
  const fillRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 }); // the art box, untransformed CSS px
  useLayoutEffect(() => {
    const el = artRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.offsetWidth, h: el.offsetHeight }));
    ro.observe(el);
    setBox({ w: el.offsetWidth, h: el.offsetHeight });
    return () => ro.disconnect();
  }, [light]);
  // Lines-only SVGs: the fill comes from the mesh (once per file), drawn on the GPU with the SVG's own
  // frame; the 2D canvas is the fallback without WebGL2
  const meshFill = useMemo(() => {
    if (gpuPh && parts) return { fr: gpuPh.fr, drawn: new Set(parts) };
    if (!svg || !light || light.parts.length || !fillMesh) return null;
    const fr = svgFrame(svg);
    if (!fr) return null;
    return { fr, drawn: new Set([...svg.matchAll(/id="part-(\d+)"/g)].map((m) => Number(m[1]))) };
  }, [svg, light, fillMesh, gpuPh, parts]);
  const glRef = useRef<HTMLCanvasElement>(null);
  const gl = useRef<GLFill | null | undefined>(undefined); // undefined = not tried yet, null = no WebGL2
  const [noGL, setNoGL] = useState(false);
  // projected triangles: for clicks inside a part (and the 2D fallback); 2 ms for 65k triangles
  const projected = useMemo(() => (meshFill && fillMesh ? projectFill(fillMesh, meshFill.fr, meshFill.drawn, offsets) : null), [meshFill, fillMesh, offsets]);
  const hasFill = !!light && (light.parts.length > 0 || !!projected);
  // While a new angle is being drawn: its silhouette (the fill mesh alone, on the GPU) turns at once;
  // the old lines are hidden and the exact ones land on it when they arrive
  const ghost = useMemo(() => {
    if (gpuPh) return gpuPh; // the GPU lines are the preview
    if (!rendering || !fillMesh || !meshFill || noGL) return null;
    if (stale === undefined) {
      const a = meshFill.fr, d = [0, 1, 2].reduce((t, i) => t + Math.abs(a.d[i] - want.d[i]) + Math.abs(a.x[i] - want.x[i]), 0);
      if (d < 1e-6) return null; // the drawing on screen is already this angle
    } else if (!stale) return null;
    return placeholderFrame(fillMesh, want, new Set(parts ?? meshFill.drawn), offsets);
  }, [gpuPh, rendering, stale, fillMesh, meshFill, noGL, want, parts, offsets]);
  const vb = ghost?.vb ?? light?.vb;
  const fitted = vb && box.w > 0 ? fitBox(box.w, box.h, vb) : null;
  const [theme, setTheme] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  useLayoutEffect(() => {
    const c = fillRef.current, el = artRef.current;
    if (!el || !light || !fitted || !hasFill) return;
    const cs = getComputedStyle(el);
    const colours = { bg: cs.getPropertyValue('--color-bg'), accent: cs.getPropertyValue('--color-accent') };
    if (meshFill && fillMesh && !noGL && glRef.current) {
      if (gl.current && gl.current.canvas !== glRef.current) gl.current = undefined; // canvas was re-created
      if (gl.current === undefined) gl.current = GLFill.create(glRef.current);
      if (gl.current) {
        const vbNow = ghost?.vb ?? light.vb;
        const [bw, bh] = backingSize(vbNow, fitted.w);
        if (glRef.current.width !== bw) glRef.current.width = bw;
        if (glRef.current.height !== bh) glRef.current.height = bh;
        const { bg, tint } = fillColours(colours);
        gl.current.setMesh(fillMesh);
        if (ghost) {
          // the real edges, hidden ones removed by a real depth buffer, until the exact drawing lands
          const { line, accent } = fillColours({ ...colours, line: cs.getPropertyValue('--color-line') });
          gl.current.draw(
            ghost.fr,
            ghost.vb,
            new Set(parts ?? meshFill.drawn),
            bg,
            tint,
            selected,
            { colour: line, selected: accent, widthPx: bw / fitted.w }, // 1 CSS px, like the SVG lines
            offsets,
          );
        } else gl.current.draw(meshFill.fr, light.vb, meshFill.drawn, bg, tint, selected, undefined, offsets);
        return;
      }
      setNoGL(true);
      return;
    }
    if (!c) return;
    if (light.parts.length) drawFill(c, light, fitted.w, fitted.h, colours, selected);
    else if (projected) drawProjectedFill(c, projected, light.vb, fitted.w, colours, selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light, meshFill, projected, noGL, ghost, fitted?.w, fitted?.h, selected, theme, offsets]);
  // Lines: 1 screen px at any zoom (instead of non-scaling-stroke, which forces a full repaint on every
  // zoom/pan frame); updated once the gesture settles
  useLayoutEffect(() => {
    if (fitted) artRef.current?.style.setProperty('--lw', String(1 / (fitted.s * zv.z)));
  }, [fitted, zv.z]);

  // ---------- exploded: a translate gizmo on the selected part (drag an arrow to move along that axis)
  const gizmo = useMemo(() => {
    if (layout?.mode !== 'exploded' || selected === null || !fillMesh || !onDragPart) return null;
    const fr = ghost?.fr ?? meshFill?.fr, vbNow = ghost?.vb ?? light?.vb;
    const m = fillMesh.find((q) => q.part === selected);
    if (!fr || !vbNow || !m) return null;
    const [dx, dy, dz] = fr.d, [xx, xy, xz] = fr.x;
    const Y = [dy * xz - dz * xy, dz * xx - dx * xz, dx * xy - dy * xx];
    const o = offsets?.[selected] ?? [0, 0, 0];
    const c = [0, 1, 2].map((k) => m.centre[k] + o[k]);
    const at = [(c[0] * xx + c[1] * xy + c[2] * xz - fr.x0) * fr.s + fr.pad, (fr.y1 - (c[0] * Y[0] + c[1] * Y[1] + c[2] * Y[2])) * fr.s + fr.pad];
    // each model axis on screen (viewBox units per model mm)
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((a, k) => ({
      key: (['x', 'y', 'z'] as const)[k],
      a,
      v: [(a[0] * xx + a[1] * xy + a[2] * xz) * fr.s, -(a[0] * Y[0] + a[1] * Y[1] + a[2] * Y[2]) * fr.s],
    }));
    return { part: selected, at, axes, vb: vbNow };
  }, [layout?.mode, selected, fillMesh, onDragPart, ghost, meshFill, light, offsets]);
  const gizmoDrag = useRef<{ id: number; axis: number[]; v: number[]; x: number; y: number } | null>(null);
  const gizmoDown = (e: React.PointerEvent, axis: number[], v: number[]) => {
    e.stopPropagation(); // not a pan
    gizmoDrag.current = { id: e.pointerId, axis, v, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const gizmoMove = (e: React.PointerEvent) => {
    const g = gizmoDrag.current;
    if (!g || g.id !== e.pointerId || !gizmo || !fitted || !onDragPart) return;
    const mx = e.clientX - g.x, my = e.clientY - g.y;
    g.x = e.clientX;
    g.y = e.clientY;
    const k = fitted.s * zv.z; // CSS px per viewBox unit
    const vx = g.v[0] * k, vy = g.v[1] * k, len2 = vx * vx + vy * vy;
    if (len2 < 1e-9) return;
    const t = (mx * vx + my * vy) / len2; // model mm along the axis
    onDragPart(gizmo.part, g.axis.map((a) => a * t));
  };
  const gizmoUp = (e: React.PointerEvent) => {
    if (gizmoDrag.current?.id === e.pointerId) gizmoDrag.current = null;
  };

  /** Part index under a screen point: its lines (<g id="part-i">) or its fill. */
  const partAt = (cx: number, cy: number): number | null => {
    const el = document.elementFromPoint(cx, cy);
    if (!el || !stageRef.current?.contains(el)) return null;
    const g = el.closest('[id^="part-"]');
    if (g && artRef.current?.contains(g)) return Number(g.id.slice(5));
    const svgEl = artRef.current?.querySelector('svg');
    if (!svgEl || !light || (ghost && !gpuPh)) return null;
    const r = svgEl.getBoundingClientRect(); // includes zoom/pan
    const k = Math.min(r.width / light.vb[0], r.height / light.vb[1]);
    const ox = r.left + (r.width - light.vb[0] * k) / 2, oy = r.top + (r.height - light.vb[1] * k) / 2;
    const x = (cx - ox) / k, y = (cy - oy) / k;
    return light.parts.length ? fillPartAt(light, x, y) : projected ? projectedPartAt(projected, x, y) : null;
  };

  // Mark the selected part in the SVG (accent stroke + faint accent fill)
  useLayoutEffect(() => {
    const root = artRef.current;
    if (!root) return;
    root.querySelectorAll('.is-selected').forEach((n) => n.classList.remove('is-selected'));
    if (selected === null) return;
    root.querySelector(`#part-${selected}`)?.classList.add('is-selected');
  }, [light, selected]);

  // Name tag at the left-middle of the selected part (follows zoom and pan)
  useLayoutEffect(() => {
    const g = selected === null ? null : artRef.current?.querySelector(`#part-${selected}`);
    const stage = stageRef.current;
    if (!g || !stage) return setTag(null);
    const b = g.getBoundingClientRect(), r = stage.getBoundingClientRect();
    setTag({ x: b.left - r.left, y: b.top - r.top + b.height / 2 });
  }, [svg, selected, zv, size]);

  // Wheel / trackpad zoom around the cursor
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !hasModel) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [hasModel, zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (d.moved >= 4) panBy(dx, dy);
  };
  const endPan = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setPanning(false);
    endGesture();
    // A click (not a drag) selects the part under the cursor, or clears the selection
    if (selectable && e.type === 'pointerup' && d.moved < 4) onSelect(partAt(e.clientX, e.clientY));
  };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!selectable) return;
    const i = partAt(e.clientX, e.clientY);
    if (i === null) return setCtx(null);
    const r = stageRef.current!.getBoundingClientRect();
    onSelect(i);
    setCtx({ i, x: Math.min(e.clientX - r.left, size.w - 200), y: Math.min(e.clientY - r.top, size.h - 230) });
  };

  const partMenu = (i: number) => [
    i === isolated ? { key: 'unisolate', label: 'Unisolate', meta: 'I' } : { key: 'isolate', label: 'Isolate', meta: 'I' },
    { key: 'hide', label: 'Hide', meta: 'H' },
    { key: 'select', label: 'Select in list' },
    { key: 'download', label: 'Download this part' },
    { key: 'div', label: '', divider: true },
    { key: 'showAll', label: 'Show all', meta: '⇧H' },
  ];

  return (
    <main className={`relative h-full min-w-0 flex-1 overflow-hidden bg-bg ${hasModel ? '' : 'dot-grid'}`}>
      {hasModel && <IsoGrid />}

      {!hasModel && <DropZone dragging={dragging} busy={!!loadingName} fileName={loadingName ?? undefined} onBrowse={onBrowse} />}
      {!hasModel && onShowPanel && (
        <div className="absolute top-6 left-6">
          <PanelButton onClick={onShowPanel} label="Show panel" />
        </div>
      )}

      {hasModel && (
        <>
          {/* Stage: WebGL preview; takes wheel, drag (pan), click (select) and right-click */}
          <div
            ref={stageRef}
            className={`absolute inset-0 touch-none select-none ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onContextMenu={onContextMenu}
          >
            <div ref={layer} className="absolute inset-0 origin-top-left" style={{ transform }}>
              <div className="absolute top-20 bottom-12 left-12" style={{ right: CARD_SPACE + 48 }}>
                {light && (
                  <div className={`relative size-full transition-opacity duration-150 ${rendering && !ghost ? 'opacity-40' : ''}`}>
                    {fitted && hasFill && (
                      <canvas
                        // a canvas keeps its first context type: GPU (mesh fill) and 2D (fallback) get their own
                        key={meshFill && !noGL ? 'gl' : '2d'}
                        ref={meshFill && !noGL ? glRef : fillRef}
                        className="pointer-events-none absolute"
                        style={{ left: fitted.x, top: fitted.y, width: fitted.w, height: fitted.h }}
                        aria-hidden
                      />
                    )}
                    {gizmo && fitted && (
                      <svg
                        className="absolute overflow-visible"
                        style={{ left: fitted.x, top: fitted.y, width: fitted.w, height: fitted.h, zIndex: 2 }}
                        viewBox={`0 0 ${gizmo.vb[0]} ${gizmo.vb[1]}`}
                        aria-label="Move the part along an axis"
                      >
                        {gizmo.axes.map(({ key, a, v }) => {
                          const u = 1 / (fitted.s * zv.z); // viewBox units per screen px
                          const L = Math.hypot(v[0], v[1]);
                          if (L * fitted.s * zv.z < 0.15) return null; // axis points at you: nothing to drag
                          const d = [v[0] / L, v[1] / L];
                          const len = 58 * u, head = 9 * u;
                          const ex = gizmo.at[0] + d[0] * len, ey = gizmo.at[1] + d[1] * len;
                          const nx = -d[1], ny = d[0];
                          return (
                            <g key={key} className="cursor-grab active:cursor-grabbing" onPointerDown={(e) => gizmoDown(e, a, v)} onPointerMove={gizmoMove} onPointerUp={gizmoUp} onPointerCancel={gizmoUp}>
                              <line x1={gizmo.at[0]} y1={gizmo.at[1]} x2={ex} y2={ey} stroke="transparent" strokeWidth={14 * u} />
                              <line x1={gizmo.at[0]} y1={gizmo.at[1]} x2={ex - d[0] * head * 0.6} y2={ey - d[1] * head * 0.6} stroke={AXIS_COLOR[key]} strokeWidth={2.5 * u} strokeLinecap="round" />
                              <path d={`M${ex} ${ey}L${ex - d[0] * head + nx * head * 0.5} ${ey - d[1] * head + ny * head * 0.5}L${ex - d[0] * head - nx * head * 0.5} ${ey - d[1] * head - ny * head * 0.5}Z`} fill={AXIS_COLOR[key]} />
                            </g>
                          );
                        })}
                        <circle cx={gizmo.at[0]} cy={gizmo.at[1]} r={4 / (fitted.s * zv.z)} fill="var(--t-surface)" stroke="var(--t-fg)" strokeWidth={1.5 / (fitted.s * zv.z)} />
                      </svg>
                    )}
                    <div
                      ref={artRef}
                      className="lineart absolute inset-0"
                      style={ghost ? { visibility: 'hidden' } : undefined}
                      dangerouslySetInnerHTML={{ __html: light.html }}
                    />
                  </div>
                )}
              </div>
            </div>
            {tag && !moving && selected !== null && (
              <div
                className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded bg-accent px-1.5 py-[3px] text-[11px] font-medium whitespace-nowrap text-on-accent"
                style={{ left: tag.x, top: tag.y }}
              >
                {partName(selected)}
              </div>
            )}
            {(message || (!svg && rendering)) && (
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center text-[13px] text-fg-3" style={{ right: CARD_SPACE }}>
                {message ?? 'Drawing…'}
              </div>
            )}
          </div>

          <div className="absolute top-6 left-6 flex items-center gap-2">
            {onShowPanel && <PanelButton onClick={onShowPanel} label="Show panel" />}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex h-[34px] items-center gap-2 rounded-lg border border-border bg-surface pr-2.5 pl-3 text-[13px] font-medium hover:border-fg-3 hover:bg-surface-hover"
              >
                {label} view
                <Chevron className="text-fg-2" />
              </button>
              {menuOpen && (
                <Menu
                  className="top-10 left-0"
                  items={VIEWS.map((v) => ({ key: v.id, label: v.id === 'iso' ? 'ISO view' : v.label, meta: v.meta }))}
                  active={view}
                  onSelect={(k) => {
                    onView(k as View);
                    setMenuOpen(false);
                  }}
                  onClose={() => setMenuOpen(false)}
                />
              )}
            </div>
            <ZoomControl
              zoom={zv.z}
              onZoomIn={() => zoomAt(1.25, freeW / 2, size.h / 2)}
              onZoomOut={() => zoomAt(1 / 1.25, freeW / 2, size.h / 2)}
              onFit={fit}
            />
            <div className="flex items-center gap-0.5 rounded-[10px] border border-border bg-surface px-1 py-0.5">
              <button type="button" className={toolBtn} onClick={onUndo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
                <UndoIcon />
              </button>
              <button type="button" className={toolBtn} onClick={onRedo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
                <RedoIcon />
              </button>
            </div>
            {isolationLabel && (
              <div className="flex h-[34px] items-center gap-2 rounded-lg border border-border bg-surface pr-1 pl-3 text-[12px] text-fg-2">
                <span className="max-w-[220px] truncate">{isolationLabel}</span>
                <span className="text-fg-3">·</span>
                <button type="button" onClick={onIsolationAction} className="flex h-7 items-center rounded-md px-1.5 text-fg hover:text-accent">
                  {isolationAction}
                </button>
              </div>
            )}
          </div>

          <div className="absolute top-6 right-6 flex flex-col gap-2.5">
            <OrientationCard rot={rot} step={step} onRotate={onRotate} onStep={onStep} onReset={onReset} />
            {layout && onLayout && onSpread && (
              <LayoutCard layout={layout} onLayout={onLayout} onSpread={onSpread} onReset={onResetLayout} />
            )}
          </div>

          {ctx && (
            <Menu
              header={partName(ctx.i)}
              style={{ left: ctx.x, top: ctx.y }}
              items={partMenu(ctx.i)}
              onSelect={(k) => {
                setCtx(null);
                onPartAction(k as PartAction, ctx.i);
              }}
              onClose={() => setCtx(null)}
            />
          )}

          {(preparing || (rendering && svg)) && (
            <div
              className="pointer-events-none absolute bottom-6 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-fg-2"
              style={{ left: `calc((100% - ${CARD_SPACE}px) / 2)` }}
            >
              <span className="size-1.5 animate-pulse rounded-full bg-accent" />
              {preparing ?? `Drawing ${label} view…`}
            </div>
          )}

          {/* A new file dragged over a loaded model */}
          <div
            className={`pointer-events-none absolute inset-0 z-40 bg-bg/78 transition-opacity duration-[140ms] ease-out ${dragging ? 'opacity-100' : 'opacity-0'}`}
            aria-hidden={!dragging}
          >
            <div className="absolute inset-6 flex flex-col items-center justify-center gap-2 rounded-[14px] bg-accent/5">
              <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
                <rect
                  x="0.75"
                  y="0.75"
                  rx="14"
                  style={{ width: 'calc(100% - 1.5px)', height: 'calc(100% - 1.5px)' }}
                  fill="none"
                  stroke="color-mix(in srgb, var(--t-accent) 50%, transparent)"
                  strokeWidth="1.5"
                  strokeDasharray="8 6"
                />
              </svg>
              <p className="text-[20px] font-medium text-accent/50">Drop to replace</p>
              <p className="text-[12px] text-fg-2">{fileName} will be closed</p>
            </div>
          </div>

          {loadingName && !dragging && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-fg-2">
              Reading {loadingName}…
            </div>
          )}
        </>
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
