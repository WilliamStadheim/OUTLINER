'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VIEWS, type Rot, type View } from '@/lib/views';
import { Chevron, CubeIcon, FitIcon, MinusIcon, PanelButton, PlusIcon, RedoIcon, UndoIcon } from './icons';
import OrientationCard from './OrientationCard';
import { Menu } from './ui';
import { useViewport } from './useViewport';
import { drawFill, fillPartAt, fitBox, splitFill } from '@/lib/lightFill';

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
}: {
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
  const light = useMemo(() => (svg ? splitFill(svg) : null), [svg]);
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
  const fitted = light && box.w > 0 ? fitBox(box.w, box.h, light.vb) : null;
  const [theme, setTheme] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  useLayoutEffect(() => {
    const c = fillRef.current, el = artRef.current;
    if (!c || !el || !light || !fitted || !light.parts.length) return;
    const cs = getComputedStyle(el);
    drawFill(c, light, fitted.w, fitted.h, { bg: cs.getPropertyValue('--color-bg'), accent: cs.getPropertyValue('--color-accent') }, selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [light, fitted?.w, fitted?.h, selected, theme]);
  // Lines: 1 screen px at any zoom (instead of non-scaling-stroke, which forces a full repaint on every
  // zoom/pan frame); updated once the gesture settles
  useLayoutEffect(() => {
    if (fitted) artRef.current?.style.setProperty('--lw', String(1 / (fitted.s * zv.z)));
  }, [fitted, zv.z]);

  /** Part index under a screen point: its lines (<g id="part-i">) or its fill. */
  const partAt = (cx: number, cy: number): number | null => {
    const el = document.elementFromPoint(cx, cy);
    if (!el || !stageRef.current?.contains(el)) return null;
    const g = el.closest('[id^="part-"]');
    if (g && artRef.current?.contains(g)) return Number(g.id.slice(5));
    const svgEl = artRef.current?.querySelector('svg');
    if (!svgEl || !light) return null;
    const r = svgEl.getBoundingClientRect(); // includes zoom/pan
    const k = Math.min(r.width / light.vb[0], r.height / light.vb[1]);
    const ox = r.left + (r.width - light.vb[0] * k) / 2, oy = r.top + (r.height - light.vb[1] * k) / 2;
    return fillPartAt(light, (cx - ox) / k, (cy - oy) / k);
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
                  <div className={`relative size-full transition-opacity duration-150 ${rendering ? 'opacity-40' : ''}`}>
                    {fitted && light.parts.length > 0 && (
                      <canvas
                        ref={fillRef}
                        className="pointer-events-none absolute"
                        style={{ left: fitted.x, top: fitted.y, width: fitted.w, height: fitted.h }}
                        aria-hidden
                      />
                    )}
                    <div ref={artRef} className="lineart absolute inset-0" dangerouslySetInnerHTML={{ __html: light.html }} />
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

          <div className="absolute top-6 right-6">
            <OrientationCard rot={rot} step={step} onRotate={onRotate} onStep={onStep} onReset={onReset} />
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
