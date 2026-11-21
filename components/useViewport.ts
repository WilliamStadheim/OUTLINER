import { useCallback, useEffect, useRef, useState } from 'react';

export type ZV = { z: number; x: number; y: number }; // translate(x, y) scale(z), origin top-left

const css = (v: ZV) => `translate(${v.x}px, ${v.y}px) scale(${v.z})`;

/**
 * Zoom + pan of a CSS-transformed layer that stays smooth on big SVGs.
 *
 * During a gesture (drag, wheel, pinch) the transform is written straight to the layer, at most once
 * per frame, and the layer is promoted (will-change) so the browser only moves/scales a bitmap; no
 * React render happens. Shortly after the gesture stops, the state is committed: React renders once
 * (zoom %, overlays) and the promotion is dropped so the drawing is re-rasterised sharp.
 */
export function useViewport(clamp: (z: number) => number) {
  const layer = useRef<HTMLDivElement>(null);
  const cur = useRef<ZV>({ z: 1, x: 0, y: 0 });
  const [zv, setZv] = useState<ZV>(cur.current);
  const [moving, setMoving] = useState(false);
  const frame = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useRef(false);

  const commit = useCallback(() => {
    settle.current = null;
    live.current = false;
    const el = layer.current;
    if (el) el.style.willChange = '';
    setZv({ ...cur.current });
    setMoving(false);
  }, []);

  const write = useCallback(() => {
    frame.current = 0;
    const el = layer.current;
    if (el) el.style.transform = css(cur.current);
  }, []);

  /** Move to `next`. live: part of an ongoing gesture (commit later); otherwise commit now. */
  const set = useCallback(
    (next: ZV, isLive: boolean) => {
      cur.current = next;
      if (isLive) {
        if (!live.current) {
          live.current = true;
          if (layer.current) layer.current.style.willChange = 'transform';
          setMoving(true);
        }
        if (!frame.current) frame.current = requestAnimationFrame(write);
        if (settle.current) clearTimeout(settle.current);
        settle.current = setTimeout(commit, 140);
      } else {
        if (frame.current) cancelAnimationFrame(frame.current);
        frame.current = 0;
        if (settle.current) clearTimeout(settle.current);
        write();
        commit();
      }
    },
    [commit, write],
  );

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number, isLive = true) => {
      const v = cur.current;
      const z = clamp(v.z * factor);
      const k = z / v.z;
      set({ z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }, isLive);
    },
    [clamp, set],
  );
  const panBy = useCallback((dx: number, dy: number) => {
    const v = cur.current;
    set({ ...v, x: v.x + dx, y: v.y + dy }, true);
  }, [set]);
  const fit = useCallback(() => set({ z: 1, x: 0, y: 0 }, false), [set]);
  /** End of a drag: commit right away instead of waiting. */
  const end = useCallback(() => {
    if (live.current) {
      if (settle.current) clearTimeout(settle.current);
      if (frame.current) cancelAnimationFrame(frame.current);
      write();
      commit();
    }
  }, [commit, write]);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      if (settle.current) clearTimeout(settle.current);
    },
    [],
  );

  return { layer, zv, moving, zoomAt, panBy, fit, end, transform: css(zv), current: cur };
}
