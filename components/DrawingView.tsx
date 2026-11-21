'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DrawingData } from '@/lib/sheet';
import type { Rot } from '@/lib/views';
import OrientationCard from './OrientationCard';
import { CARD_SPACE, IsoGrid, ZoomControl, clampZoom } from './Preview';

/** Drawing mode canvas: the sheet (exactly the SVG that gets downloaded) on the iso grid. */
export default function DrawingView({
  drawing,
  sheetSvg,
  loading,
  error,
  cells,
  focusedField,
  onFieldClick,
  rot,
  step,
  onRotate,
  onStep,
  onReset,
  fileKey,
}: {
  drawing: DrawingData | null;
  sheetSvg: string | null;
  loading: boolean;
  error: string | null;
  cells: Record<string, [number, number, number, number]>;
  focusedField: string | null;
  onFieldClick: (id: string) => void;
  rot: Rot;
  step: number;
  onRotate: (axis: number, delta: number) => void;
  onStep: (s: number) => void;
  onReset: () => void;
  fileKey: string | null;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
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
  const top = 80, bottom = 48, side = 48;
  const k = Math.max(0.1, Math.min((freeW - 2 * side) / W, (size.h - top - bottom) / H)); // px per mm
  const sw = W * k, sh = H * k;
  const left = (freeW - sw) / 2, y = top + (size.h - top - bottom - sh) / 2;

  const [zv, setZv] = useState({ z: 1, x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; moved: number } | null>(null);
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    setZv((v) => {
      const z = clampZoom(v.z * factor);
      const r = z / v.z;
      return { z, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r };
    });
  }, []);
  const fit = () => setZv({ z: 1, x: 0, y: 0 });
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
    if (d.moved >= 4) setZv((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const endPan = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setPanning(false);
    if (e.type !== 'pointerup' || d.moved >= 4) return;
    // A click on a title block value edits that field in the panel
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const field = el?.closest('[data-field]')?.getAttribute('data-field');
    if (field) onFieldClick(field);
  };

  const hl = focusedField ? cells[focusedField] : undefined;

  return (
    <main className="relative h-full min-w-0 flex-1 overflow-hidden bg-bg">
      <IsoGrid />
      <div
        ref={stageRef}
        className={`absolute inset-0 touch-none select-none ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <div className="absolute inset-0 origin-top-left" style={{ transform: `translate(${zv.x}px, ${zv.y}px) scale(${zv.z})` }}>
          {sheetSvg && size.w > 0 && (
            <div
              className={`absolute bg-white shadow-[0_0_1px_1px_rgb(0_0_0/0.06),0_6px_24px_rgb(0_0_0/0.1)] transition-opacity duration-150 ${loading ? 'opacity-60' : ''}`}
              style={{ left, top: y, width: sw, height: sh }}
            >
              <div className="size-full [&>svg]:block [&>svg]:size-full [&_[data-field]]:cursor-text" dangerouslySetInnerHTML={{ __html: sheetSvg }} />
              {hl && (
                <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${W} ${H}`} aria-hidden>
                  <rect
                    x={hl[0]}
                    y={hl[1]}
                    width={hl[2]}
                    height={hl[3]}
                    fill="color-mix(in srgb, var(--t-accent) 10%, transparent)"
                    stroke="var(--t-accent)"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              )}
            </div>
          )}
        </div>
        {!sheetSvg && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center text-[13px] text-fg-3" style={{ right: CARD_SPACE }}>
            Drawing views…
          </div>
        )}
      </div>

      <div className="absolute top-6 left-6 flex items-center gap-2">
        <ZoomControl zoom={zv.z} onZoomIn={() => zoomAt(1.25, freeW / 2, size.h / 2)} onZoomOut={() => zoomAt(1 / 1.25, freeW / 2, size.h / 2)} onFit={fit} />
      </div>

      <div className="absolute top-6 right-6">
        <OrientationCard rot={rot} step={step} onRotate={onRotate} onStep={onStep} onReset={onReset} />
      </div>

      {loading && sheetSvg && (
        <div
          className="pointer-events-none absolute bottom-6 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] text-fg-2"
          style={{ left: `calc((100% - ${CARD_SPACE}px) / 2)` }}
        >
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          Drawing views…
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
