// Balloons (item numbers) for the exploded drawing, placed by the rules from the OCU drawing:
//  - leaders are straight: vertical to rings above/below the view, horizontal to rings on the sides
//  - rings on a side stand in one row (same y on top/bottom, same x left/right), a fixed distance apart
//  - the anchor dot sits on a visible face of the part, well inside its edges (found from a depth-tested
//    ID picture of the parts, made here from the scene mesh with the same camera as the exact lines)
//  - order: side by the part's position, then the anchor, then the ring; if two rings collide the anchor
//    moves along the part (never a slanted leader)
//  - leaders never cross each other, and avoid running over other parts where another side or anchor can

import type { FillMesh } from './lightFill';
import type { Pt, SheetView } from './sheet';

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Balloon = { key: string; part: number; side: Side; anchor: Pt; ring: Pt };
/** A user's adjustment: the side, and the anchor in the view's model frame (survives sheet/scale changes). */
export type BalloonEdit = { side: Side; anchor: Pt };

export const RING_R = 3.6; // paper mm
const GAP = 1.6; // between rings in a row
const ROW_OUT = RING_R + 5; // from the view's box to the ring centres
const CELL = 0.5; // ID picture resolution, paper mm

type IdPicture = { w: number; h: number; x0: number; y0: number; id: Int32Array; dist: Float32Array };

/** Depth-tested picture of which part is seen where (paper mm cells), plus each cell's distance (cells)
 *  to the nearest cell of another part or background: how far inside the visible face it is. */
export function idPicture(mesh: FillMesh, cam: number[], offsets: Record<number, number[]> | undefined, v: SheetView, parts: Set<number>): IdPicture {
  const [dx, dy, dz, xx, xy, xz] = cam;
  const yx = dy * xz - dz * xy, yy = dz * xx - dx * xz, yz = dx * xy - dy * xx;
  const [rx0, ry0, rx1, ry1] = v.rect;
  const x0 = rx0 - 2, y0 = ry0 - 2;
  const w = Math.ceil((rx1 - rx0 + 4) / CELL), h = Math.ceil((ry1 - ry0 + 4) / CELL);
  const id = new Int32Array(w * h).fill(-1);
  const depth = new Float32Array(w * h).fill(-Infinity);
  for (const m of mesh) {
    if (!parts.has(m.part) || !m.tris.length) continue;
    const [ox, oy, oz] = offsets?.[m.part] ?? [0, 0, 0];
    const n = m.nodes, N = n.length / 3;
    const X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = n[3 * i] + ox, b = n[3 * i + 1] + oy, c = n[3 * i + 2] + oz;
      X[i] = (v.ox + (a * xx + b * xy + c * xz) * v.sc - x0) / CELL;
      Y[i] = (v.oy - (a * yx + b * yy + c * yz) * v.sc - y0) / CELL;
      Z[i] = a * dx + b * dy + c * dz; // larger = nearer the viewer
    }
    const t = m.tris;
    for (let k = 0; k < t.length; k += 3) {
      const i0 = t[k], i1 = t[k + 1], i2 = t[k + 2];
      const ax = X[i0], ay = Y[i0], bx = X[i1], by = Y[i1], cx = X[i2], cy = Y[i2];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      const minx = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxx = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const miny = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxy = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      const za = Z[i0], zb = Z[i1], zc = Z[i2];
      for (let yy2 = miny; yy2 <= maxy; yy2++) {
        const py = yy2 + 0.5;
        for (let xx2 = minx; xx2 <= maxx; xx2++) {
          const pxx = xx2 + 0.5;
          const w0 = ((bx - pxx) * (cy - py) - (by - py) * (cx - pxx)) / area;
          const w1 = ((cx - pxx) * (ay - py) - (cy - py) * (ax - pxx)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * za + w1 * zb + w2 * zc, o = yy2 * w + xx2;
          if (z > depth[o]) {
            depth[o] = z;
            id[o] = m.part;
          }
        }
      }
    }
  }
  // chamfer distance (3-4) to the nearest cell that is not the same part
  const INF = 1e9, dist = new Float32Array(w * h);
  for (let o = 0; o < w * h; o++) dist[o] = id[o] < 0 ? 0 : INF;
  const same = (o: number, q: number) => id[q] === id[o];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * w + x;
      if (!dist[o]) continue;
      let d = dist[o];
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) d = 3;
      if (x > 0) d = Math.min(d, same(o, o - 1) ? dist[o - 1] + 3 : 3);
      if (y > 0) d = Math.min(d, same(o, o - w) ? dist[o - w] + 3 : 3);
      if (x > 0 && y > 0) d = Math.min(d, same(o, o - w - 1) ? dist[o - w - 1] + 4 : 4);
      if (x < w - 1 && y > 0) d = Math.min(d, same(o, o - w + 1) ? dist[o - w + 1] + 4 : 4);
      dist[o] = d;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const o = y * w + x;
      if (!dist[o]) continue;
      let d = dist[o];
      if (x < w - 1) d = Math.min(d, same(o, o + 1) ? dist[o + 1] + 3 : 3);
      if (y < h - 1) d = Math.min(d, same(o, o + w) ? dist[o + w] + 3 : 3);
      if (x < w - 1 && y < h - 1) d = Math.min(d, same(o, o + w + 1) ? dist[o + w + 1] + 4 : 4);
      if (x > 0 && y < h - 1) d = Math.min(d, same(o, o + w - 1) ? dist[o + w - 1] + 4 : 4);
      dist[o] = d;
    }
  for (let o = 0; o < w * h; o++) dist[o] /= 3;
  return { w, h, x0, y0, id, dist };
}

const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

export type Rows = Record<Side, number>; // y of the top/bottom rows, x of the left/right rows

export function balloonRows(v: SheetView, bounds: [number, number, number, number]): Rows {
  const [x0, y0, x1, y1] = v.rect;
  return {
    top: Math.max(bounds[1] + RING_R, y0 - ROW_OUT),
    bottom: Math.min(bounds[3] - RING_R, y1 + ROW_OUT),
    left: Math.max(bounds[0] + RING_R, x0 - ROW_OUT),
    right: Math.min(bounds[2] - RING_R, x1 + ROW_OUT),
  };
}

/** Where the ring of an anchor goes on a side (straight out from the anchor). */
export const ringFor = (side: Side, a: Pt, rows: Rows): Pt =>
  side === 'top' || side === 'bottom' ? [a[0], rows[side]] : [rows[side], a[1]];

/** Leader end at the ring's edge. */
export const leaderEnd = (b: Balloon): Pt => {
  const r = RING_R;
  return b.side === 'top' ? [b.ring[0], b.ring[1] + r] : b.side === 'bottom' ? [b.ring[0], b.ring[1] - r] : b.side === 'left' ? [b.ring[0] + r, b.ring[1]] : [b.ring[0] - r, b.ring[1]];
};

/**
 * Place one balloon per group (identical parts share one; the instance seen most gets it).
 * `fixed`: balloons the user placed by hand, kept as they are and avoided by the others.
 */
export function placeBalloons(
  pic: IdPicture,
  v: SheetView,
  groups: { key: string; parts: number[] }[],
  bounds: [number, number, number, number],
  fixed: Balloon[] = [],
): Balloon[] {
  const rows = balloonRows(v, bounds);
  const [vx0, vy0, vx1, vy1] = v.rect;
  const C: Pt = [(vx0 + vx1) / 2, (vy0 + vy1) / 2];
  const cellPt = (o: number): Pt => [pic.x0 + ((o % pic.w) + 0.5) * CELL, pic.y0 + (Math.floor(o / pic.w) + 0.5) * CELL];
  const at = (p: Pt) => {
    const x = Math.floor((p[0] - pic.x0) / CELL), y = Math.floor((p[1] - pic.y0) / CELL);
    return x < 0 || y < 0 || x >= pic.w || y >= pic.h ? -1 : pic.id[y * pic.w + x];
  };
  // paper mm of a leader that runs over other parts
  const overOthers = (a: Pt, b: Pt, part: number) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(L / CELL);
    let over = 0;
    for (let i = 1; i < n; i++) {
      const id = at([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
      if (id >= 0 && id !== part) over += CELL;
    }
    return over;
  };

  // visible cells per part
  const cells = new Map<number, number[]>();
  for (let o = 0; o < pic.id.length; o++) {
    const p = pic.id[o];
    if (p < 0) continue;
    let a = cells.get(p);
    if (!a) cells.set(p, (a = []));
    a.push(o);
  }

  const placed: Balloon[] = [...fixed];
  const fixedKeys = new Set(fixed.map((b) => b.key));
  const order = groups
    .filter((g) => !fixedKeys.has(g.key))
    .map((g) => {
      const part = g.parts.reduce((best, p) => ((cells.get(p)?.length ?? 0) > (cells.get(best)?.length ?? 0) ? p : best), g.parts[0]);
      return { g, part, n: cells.get(part)?.length ?? 0 };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => a.n - b.n); // small parts first: they have the fewest good anchors

  const sides: Side[] = ['top', 'right', 'bottom', 'left'];
  for (const { g, part } of order) {
    const cs = cells.get(part)!;
    let maxD = 0, sx = 0, sy = 0;
    for (const o of cs) {
      maxD = Math.max(maxD, pic.dist[o]);
      const p = cellPt(o);
      sx += p[0];
      sy += p[1];
    }
    const cen: Pt = [sx / cs.length, sy / cs.length];
    // preferred side by position in the view (normalised, so wide views still use top/bottom)
    const nx = (cen[0] - C[0]) / Math.max(vx1 - vx0, 1), ny = (cen[1] - C[1]) / Math.max(vy1 - vy0, 1);
    const pref: Side = Math.abs(nx) > Math.abs(ny) ? (nx < 0 ? 'left' : 'right') : ny < 0 ? 'top' : 'bottom';
    const opposite: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
    // anchors well inside the visible face: the inner half of the depth, thinned out
    const thr = Math.max(Math.min(2.5, maxD), maxD * 0.45);
    const inner = cs.filter((o) => pic.dist[o] >= thr);
    const step = Math.max(1, Math.floor(inner.length / 160));
    const cands: { side: Side; a: Pt; ring: Pt; cost: number }[] = [];
    for (let i = 0; i < inner.length; i += step) {
      const o = inner[i], a = cellPt(o), deep = pic.dist[o] * CELL;
      for (const s of sides) {
        const ring = ringFor(s, a, rows);
        const along = s === 'top' || s === 'bottom' ? ring[0] : ring[1];
        const lo = s === 'top' || s === 'bottom' ? bounds[0] + RING_R : bounds[1] + RING_R;
        const hi = s === 'top' || s === 'bottom' ? bounds[2] - RING_R : bounds[3] - RING_R;
        if (along < lo || along > hi) continue;
        const end = leaderEnd({ key: '', part, side: s, anchor: a, ring });
        const sideCost = s === pref ? 0 : s === opposite[pref] ? 40 : 14;
        const cost = sideCost + 4 * overOthers(a, end, part) - 1.5 * deep + 0.03 * Math.hypot(end[0] - a[0], end[1] - a[1]);
        cands.push({ side: s, a, ring, cost });
      }
    }
    cands.sort((p, q) => p.cost - q.cost);
    const ok = (c: { side: Side; a: Pt; ring: Pt }) => {
      const b: Balloon = { key: g.key, part, side: c.side, anchor: c.a, ring: c.ring };
      const e = leaderEnd(b);
      for (const o of placed) {
        if (Math.hypot(o.ring[0] - c.ring[0], o.ring[1] - c.ring[1]) < 2 * RING_R + GAP) return false;
        if (cross(c.a, e, o.anchor, leaderEnd(o))) return false;
        // a leader must not run through another ring
        if (segDist(o.ring, c.a, e) < RING_R + 0.3 || segDist(c.ring, o.anchor, leaderEnd(o)) < RING_R + 0.3) return false;
      }
      return true;
    };
    const pick = cands.find(ok) ?? cands[0];
    if (pick) placed.push({ key: g.key, part, side: pick.side, anchor: pick.a, ring: pick.ring });
  }
  return placed;
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L));
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
}

/** Numbering by position: clockwise around the view, starting top left (the "Auto-number" order). */
export function clockwiseOrder(bs: Balloon[], v: SheetView): string[] {
  const c: Pt = [(v.rect[0] + v.rect[2]) / 2, (v.rect[1] + v.rect[3]) / 2];
  const ang = (b: Balloon) => {
    let a = Math.atan2(b.ring[1] - c[1], b.ring[0] - c[0]) + Math.PI / 2 + Math.PI / 4; // top-left = 0
    while (a < 0) a += 2 * Math.PI;
    return a % (2 * Math.PI);
  };
  return [...bs].sort((a, b) => ang(a) - ang(b)).map((b) => b.key);
}

/** Dragging a ring along its row: the anchor stays on the part's visible face, at the cell nearest the
 *  cursor across the row (preferring cells well inside the face), so the leader stays straight. */
export function anchorNear(pic: IdPicture, part: number, side: Side, P: Pt): Pt | null {
  const vertical = side === 'top' || side === 'bottom'; // leader vertical → choose by x
  let best: Pt | null = null, bs = Infinity;
  for (let o = 0; o < pic.id.length; o++) {
    if (pic.id[o] !== part) continue;
    const x = pic.x0 + ((o % pic.w) + 0.5) * CELL, y = pic.y0 + (Math.floor(o / pic.w) + 0.5) * CELL;
    const s = Math.abs((vertical ? x : y) - (vertical ? P[0] : P[1])) - 0.6 * Math.min(pic.dist[o] * CELL, 3);
    if (s < bs) [bs, best] = [s, [x, y]];
  }
  return best;
}
