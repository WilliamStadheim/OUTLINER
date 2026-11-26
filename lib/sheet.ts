// Production drawing sheet, built in the browser as SVG (millimetre units). The same string is shown
// in the preview and downloaded (SVG, or turned into PDF), so what you see is what you get.
//
// The views are exact HLR polylines in model mm from /api/drawing; the server decides where each view
// goes (paper x = ox + x·sc, paper y = oy − y·sc). Style from the production-drawing-a4 skill.

import { RING_R, leaderEnd, type Balloon } from './balloons';

export type ViewName = 'front' | 'top' | 'right' | 'iso';
export type Pt = [number, number];

export type SheetView = {
  ox: number;
  oy: number;
  sc: number;
  rect: [number, number, number, number]; // paper mm: x0, y0, x1, y1
  bbox: [number, number, number, number]; // model mm: x0, y0, x1, y1
  polylines: Pt[][];
  // exact circles and arcs from HLR (model mm): cx, cy, r, and the start, end and middle angle (rad)
  circles: number[][];
};

export type DrawingData = {
  sheet: { w: number; h: number; margin: number; tb: [number, number] };
  scale: number;
  scaleLabel: string;
  autoScale: string;
  options: Record<string, boolean>; // every standard scale → fits the sheet
  layout: string;
  dropped: string[];
  views: Partial<Record<ViewName, SheetView>>;
  // exploded drawing only: the camera (d, x) of the ISO, and the legend area (paper mm)
  camera?: number[];
  legend?: [number, number, number, number];
  /** client only: the offsets the exploded sheet was made with */
  offsets?: Record<number, number[]>;
};

/** Sheet colours. Light is the classic white sheet; Dark matches the app. */
export type Palette = { paper: string; ink: string; frame: string; text: string; muted: string; balloon: string; dim?: string };
export const PALETTES: Record<'light' | 'dark', Palette> = {
  light: { paper: '#FFFFFF', ink: '#4D4D4D', frame: '#9A9A9A', text: '#000000', muted: '#8A8A8A', balloon: '#F75225' }, // the app's light accent
  dark: { paper: '#1C1C1C', ink: '#F0F0F0', frame: '#6E6E73', text: '#FFFFFF', muted: '#A1A1A6', balloon: '#E4FF3F' },
};

export type SheetExtras = {
  pal?: Palette;
  balloons?: { b: Balloon; n: number }[];
  legend?: { n: number; name: string; qty: number }[];
};

export type TitleField = {
  id: string;
  label: string;
  value: string;
  enabled: boolean;
  auto?: 'scale' | 'format' | 'unit';
  custom?: boolean;
};

/** A dimension. Points are model mm in the view's own 2D frame; offset is paper mm from the measured
 *  feature to the dimension line (sign = side). */
export type Dim = {
  id: string;
  view: Exclude<ViewName, 'iso'>;
  kind: 'h' | 'v' | 'aligned' | 'diameter' | 'radius';
  a: Pt;
  b: Pt; // for diameter/radius: a = centre, b = (r, angle)
  offset: number;
  main?: boolean;
};

export const LINE = 0.35; // visible contours at 1:1
export const INK = '#333333'; // outline colour: softer than pure black

/** Outline width for a view: thinner at small scales, and thinner where the lines are dense (measured
 *  in 4 mm paper cells, using the densest 2 %), so small views and fine detail like engraved text
 *  don't turn into a black lump. Widths are cached per view. */
const widthCache = new WeakMap<SheetView, number>();
export function lineWidth(v: SheetView) {
  const hit = widthCache.get(v);
  if (hit !== undefined) return hit;
  let w = LINE * Math.min(1, Math.pow(v.sc, 0.25)); // 1:2 → 0.29, 1:10 → 0.2, 1:20 → 0.17
  const C = 4, cells = new Map<string, number>();
  for (const pl of v.polylines)
    for (let i = 1; i < pl.length; i++) {
      const L = Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]) * v.sc;
      const k = `${Math.floor(((pl[i][0] + pl[i - 1][0]) / 2) * v.sc / C)},${Math.floor(((pl[i][1] + pl[i - 1][1]) / 2) * v.sc / C)}`;
      cells.set(k, (cells.get(k) ?? 0) + L);
    }
  const d = [...cells.values()].map((l) => l / (C * C)).sort((a, b) => a - b); // paper mm of line per mm²
  const dense = d.length ? d[Math.floor(0.98 * (d.length - 1))] : 0;
  if (dense > 0) w = Math.min(w, 1.2 / dense); // e.g. engraved text (≈10 mm of line per mm²) → 0.12, clamped to 0.15
  w = Math.max(0.15, Math.min(LINE, w));
  widthCache.set(v, w);
  return w;
}

/** One outline width for the whole sheet (one visible-line weight, as on a technical drawing): the
 *  thinnest any view needs. */
export function sheetLineWidth(d: DrawingData) {
  const vs = (['front', 'top', 'right', 'iso'] as ViewName[]).map((n) => d.views[n]).filter((v): v is SheetView => !!v);
  return vs.length ? Math.min(...vs.map(lineWidth)) : LINE;
}
export const DIM_COLOR = '#A8A8A8';
export const DIM_TEXT = '#6B6B6B';
export const DIM_W = 0.13;
export const DIM_SIZE = 2.6;
const GREY = '#9A9A9A';
const FONT = 'Geist, Arial, sans-serif';

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const fmtMM = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : r.toFixed(1);
};

export const toPaper = (v: SheetView, p: Pt): Pt => [v.ox + p[0] * v.sc, v.oy - p[1] * v.sc];

/** Bounding-box dimensions: width and height of FRONT, depth from RIGHT (or TOP). */
export function mainDims(d: DrawingData): Dim[] {
  const out: Dim[] = [];
  const F = d.views.front, R = d.views.right, T = d.views.top;
  if (F) {
    const [x0, y0, x1, y1] = F.bbox;
    out.push({ id: 'main-w', view: 'front', kind: 'h', a: [x0, y0], b: [x1, y0], offset: 9, main: true });
    out.push({ id: 'main-h', view: 'front', kind: 'v', a: [x0, y0], b: [x0, y1], offset: -9, main: true });
  }
  if (R) {
    const [x0, y0, x1] = R.bbox;
    out.push({ id: 'main-d', view: 'right', kind: 'h', a: [x0, y0], b: [x1, y0], offset: 9, main: true });
  } else if (T) {
    const [x0, y0, , y1] = T.bbox;
    out.push({ id: 'main-d', view: 'top', kind: 'v', a: [x0, y0], b: [x0, y1], offset: -9, main: true });
  }
  return out;
}

/** Measured value in mm (from the model, not the paper). */
export function dimValue(dim: Dim): number {
  const [a, b] = [dim.a, dim.b];
  if (dim.kind === 'h') return Math.abs(b[0] - a[0]);
  if (dim.kind === 'v') return Math.abs(b[1] - a[1]);
  if (dim.kind === 'aligned') return Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (dim.kind === 'diameter') return 2 * b[0];
  return b[0];
}

export const dimLabel = (dim: Dim) => (dim.kind === 'diameter' ? 'Ø' : dim.kind === 'radius' ? 'R' : '') + fmtMM(dimValue(dim));

/** SVG for one dimension in paper mm. colour/textColour let the editor draw the one being placed. */
export function dimSVG(d: DrawingData, dim: Dim, colour = DIM_COLOR, textColour = DIM_TEXT): string {
  const v = d.views[dim.view];
  if (!v) return '';
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${f3(x1)}" y1="${f3(y1)}" x2="${f3(x2)}" y2="${f3(y2)}" stroke="${colour}" stroke-width="${DIM_W}"/>`;
  const text = (x: number, y: number, t: string, rot = 0) =>
    `<text x="${f3(x)}" y="${f3(y)}" font-size="${DIM_SIZE}" fill="${textColour}" text-anchor="middle"${
      rot ? ` transform="rotate(${f3(rot)} ${f3(x)} ${f3(y)})"` : ''
    }>${esc(t)}</text>`;
  const label = dimLabel(dim);
  const A = toPaper(v, dim.a);
  // Width of the value text (Geist digits ≈ 0.6 em) plus a little air on each side. If the gap between
  // the extension lines is narrower, the text goes outside, past one end, on an extended dimension line,
  // so it never crosses a line.
  const tw = label.length * DIM_SIZE * 0.6 + 1.2;

  if (dim.kind === 'diameter' || dim.kind === 'radius') {
    const r = dim.b[0] * v.sc, ang = dim.b[1];
    const ux = Math.cos(ang), uy = -Math.sin(ang);
    const P0 = dim.kind === 'diameter' ? [A[0] - ux * r, A[1] - uy * r] : A;
    const P1 = [A[0] + ux * r, A[1] + uy * r];
    const tx = A[0] + ux * (r + 2 + dim.offset), ty = A[1] + uy * (r + 2 + dim.offset);
    // Filled arrowheads with their tips on the circle show exactly where the radius/diameter ends; a small
    // centre cross shows where the radius starts.
    const AL = 2.4, AW = 0.75;
    const arrow = (T: number[], dx: number, dy: number) =>
      `<path d="M${f3(T[0])} ${f3(T[1])}L${f3(T[0] - dx * AL - dy * AW)} ${f3(T[1] - dy * AL + dx * AW)}L${f3(T[0] - dx * AL + dy * AW)} ${f3(T[1] - dy * AL - dx * AW)}Z" fill="${colour}"/>`;
    const C = 1.4;
    const centre = line(A[0] - C, A[1], A[0] + C, A[1]) + line(A[0], A[1] - C, A[0], A[1] + C);
    const heads = arrow(P1, ux, uy) + (dim.kind === 'diameter' ? arrow(P0, -ux, -uy) : '');
    return `<g data-dim="${dim.id}">${centre}${line(P0[0], P0[1], P1[0], P1[1])}${line(P1[0], P1[1], tx, ty)}${heads}${text(tx + (ux >= 0 ? 4 : -4), ty - 0.8, label)}</g>`;
  }

  const B = toPaper(v, dim.b);
  let s = '';
  if (dim.kind === 'h') {
    const yd = (dim.offset >= 0 ? Math.max(A[1], B[1]) : Math.min(A[1], B[1])) + dim.offset;
    const g = dim.offset >= 0 ? 1 : -1;
    for (const P of [A, B]) s += line(P[0], P[1] + g * 1, P[0], yd + g * 1.5);
    const lo = Math.min(A[0], B[0]), hi = Math.max(A[0], B[0]);
    if (hi - lo >= tw) s += line(lo, yd, hi, yd) + text((lo + hi) / 2, yd - 1, label);
    else s += line(lo, yd, hi + 1 + tw, yd) + text(hi + 1 + tw / 2, yd - 1, label); // outside, to the right
  } else if (dim.kind === 'v') {
    const xd = (dim.offset >= 0 ? Math.max(A[0], B[0]) : Math.min(A[0], B[0])) + dim.offset;
    const g = dim.offset >= 0 ? 1 : -1;
    for (const P of [A, B]) s += line(P[0] + g * 1, P[1], xd + g * 1.5, P[1]);
    const lo = Math.min(A[1], B[1]), hi = Math.max(A[1], B[1]);
    if (hi - lo >= tw) s += line(xd, lo, xd, hi) + text(xd - 1, (lo + hi) / 2, label, -90);
    else s += line(xd, lo - 1 - tw, xd, hi) + text(xd - 1, lo - 1 - tw / 2, label, -90); // outside, above
  } else {
    const ux = B[0] - A[0], uy = B[1] - A[1], L = Math.hypot(ux, uy) || 1;
    const nx = -uy / L, ny = ux / L; // paper normal
    const o = dim.offset, g = Math.sign(o) || 1;
    const A2 = [A[0] + nx * o, A[1] + ny * o], B2 = [B[0] + nx * o, B[1] + ny * o];
    for (const [P, Q] of [[A, A2], [B, B2]]) s += line(P[0] + nx * g, P[1] + ny * g, Q[0] + nx * g * 1.5, Q[1] + ny * g * 1.5);
    let deg = (Math.atan2(uy, ux) * 180) / Math.PI;
    if (deg > 90) deg -= 180;
    if (deg <= -90) deg += 180;
    const r = (deg * Math.PI) / 180;
    const tx = Math.cos(r), ty = Math.sin(r); // along the text
    let c = [(A2[0] + B2[0]) / 2, (A2[1] + B2[1]) / 2], ends = [A2, B2];
    if (L < tw) {
      // outside, past the end the text reads towards
      const far = (B2[0] - A2[0]) * tx + (B2[1] - A2[1]) * ty >= 0 ? B2 : A2;
      const near = far === B2 ? A2 : B2;
      c = [far[0] + tx * (1 + tw / 2), far[1] + ty * (1 + tw / 2)];
      ends = [near, [far[0] + tx * (1 + tw), far[1] + ty * (1 + tw)]];
    }
    const mx = c[0] + Math.sin(r) * 1, my = c[1] - Math.cos(r) * 1;
    s += line(ends[0][0], ends[0][1], ends[1][0], ends[1][1]) + text(mx, my, label, deg);
  }
  return `<g data-dim="${dim.id}">${s}</g>`;
}

/** Title block cell rectangles (paper mm), for the editing highlight. */
/** The title block's field cells: two rows, as many columns as needed (up to 4), so there are no
 *  empty columns: 6 fields → 3 × 2, 7–8 → 4 × 2. */
export function cellGrid(n: number) {
  const cols = Math.min(4, Math.max(1, Math.ceil(n / 2)));
  return { cols, rows: n > cols ? 2 : 1 };
}

/** The fields shown in the table, in order (the title is separate). */
export const tableFields = (fields: TitleField[]) => fields.filter((f) => f.enabled && f.id !== 'title').slice(0, 8);

export function titleCells(d: DrawingData, fields: TitleField[]) {
  const [TW, TH] = d.sheet.tb;
  const tx = d.sheet.w - d.sheet.margin - TW, ty = d.sheet.h - d.sheet.margin - TH;
  const cells: Record<string, [number, number, number, number]> = { title: [tx, ty, TW, 14] };
  const shown = tableFields(fields);
  const { cols } = cellGrid(shown.length);
  shown.forEach((f, k) => {
    cells[f.id] = [tx + (k % cols) * (TW / cols), ty + 14 + Math.floor(k / cols) * 11, TW / cols, 11];
  });
  return cells;
}

export function fieldValue(f: TitleField, d: DrawingData, sheet: string) {
  if (f.auto === 'scale') return d.scaleLabel;
  if (f.auto === 'format') return sheet;
  if (f.auto === 'unit') return 'mm';
  return f.value.trim() || '—';
}

/** The whole sheet as an SVG string (mm). */
export function buildSheet(d: DrawingData, fields: TitleField[], dims: Dim[], sheetName: string, title: string, extras: SheetExtras = {}): string {
  const { w: W, h: H, margin: M } = d.sheet;
  const pal = extras.pal ?? PALETTES.light;
  const GREY = pal.frame, INK = pal.ink;
  const el: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, sw: number, col: string) =>
    el.push(`<rect x="${f3(x)}" y="${f3(y)}" width="${f3(w)}" height="${f3(h)}" fill="none" stroke="${col}" stroke-width="${sw}"/>`);
  const line = (x1: number, y1: number, x2: number, y2: number, sw: number, col: string) =>
    el.push(`<line x1="${f3(x1)}" y1="${f3(y1)}" x2="${f3(x2)}" y2="${f3(y2)}" stroke="${col}" stroke-width="${sw}"/>`);
  const text = (x: number, y: number, t: string, size: number, opts: { anchor?: string; weight?: number; fill?: string; field?: string } = {}) =>
    el.push(
      `<text x="${f3(x)}" y="${f3(y)}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? pal.text}" text-anchor="${
        opts.anchor ?? 'middle'
      }"${opts.field ? ` data-field="${opts.field}"` : ''}>${esc(t)}</text>`,
    );

  const poster = d.layout === 'exploded'; // no frame, no title block: a poster with a legend
  if (!poster) rect(M, M, W - 2 * M, H - 2 * M, 0.3, GREY);

  // views
  const label = { size: 3, weight: 500 };
  const lw = f3(sheetLineWidth(d));
  for (const name of ['front', 'top', 'right', 'iso'] as ViewName[]) {
    const v = d.views[name];
    if (!v) continue;
    const dd = v.polylines
      .map((pl) => 'M' + pl.map((p) => `${f3(v.ox + p[0] * v.sc)} ${f3(v.oy - p[1] * v.sc)}`).join('L'))
      .join('');
    el.push(
      `<path data-view="${name}" d="${dd}" fill="none" stroke="${INK}" stroke-width="${lw}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    const [x0, y0, x1, y1] = v.rect;
    const cx = (x0 + x1) / 2;
    if (name === 'top') text(cx, y0 - 5, 'TOP', label.size, { weight: label.weight });
    else if (name === 'iso') {
      if (d.layout !== 'exploded') text(cx, y1 + 8, 'ISO', label.size, { weight: label.weight });
    }
    else text(cx, y1 + 17.5, name.toUpperCase(), label.size, { weight: label.weight });
  }

  // dimensions
  const dark = pal.paper !== PALETTES.light.paper && luminance(pal.paper) < 0.4;
  for (const dim of dims) el.push(pal.dim ? dimSVG(d, dim, pal.dim, pal.dim) : dark ? dimSVG(d, dim, '#8A8A8E', '#B8B8BC') : dimSVG(d, dim));

  // balloons: leader and anchor dot in the accent (balloon) colour, ring and number in the line colour
  for (const { b, n } of extras.balloons ?? []) {
    const e = leaderEnd(b);
    const fs = n > 9 ? 2.9 : 3.2;
    el.push(
      `<g data-balloon="${esc(b.key)}"><line x1="${f3(b.anchor[0])}" y1="${f3(b.anchor[1])}" x2="${f3(e[0])}" y2="${f3(e[1])}" stroke="${pal.balloon}" stroke-width="0.2"/>` +
        `<circle cx="${f3(b.anchor[0])}" cy="${f3(b.anchor[1])}" r="0.75" fill="${pal.balloon}" data-anchor="${esc(b.key)}"/>` +
        `<circle cx="${f3(b.ring[0])}" cy="${f3(b.ring[1])}" r="${RING_R}" fill="${pal.paper}" stroke="${pal.ink}" stroke-width="0.25" data-ring="${esc(b.key)}"/>` +
        `<text x="${f3(b.ring[0])}" y="${f3(b.ring[1] + fs * 0.36)}" font-size="${fs}" font-weight="500" fill="${pal.text}" text-anchor="middle" data-ring="${esc(b.key)}">${n}</text></g>`,
    );
  }

  // parts legend: under a rule, 3 columns of (number) name ×qty; long names shrink, then end in …
  if (d.legend && extras.legend?.length) {
    const [lx0, ly0, lx1] = d.legend;
    line(lx0, ly0, lx1, ly0, 0.2, GREY);
    const cols = 3, cw = (lx1 - lx0) / cols, rowsN = Math.ceil(extras.legend.length / cols);
    extras.legend.forEach((it, k) => {
      const c = Math.floor(k / rowsN), r = k % rowsN;
      const x = lx0 + c * cw, yy = ly0 + 9 + r * 6.4;
      el.push(`<circle cx="${f3(x + 2.5)}" cy="${f3(yy - 0.9)}" r="2.5" fill="none" stroke="${pal.ink}" stroke-width="0.2"/>`);
      text(x + 2.5, yy, String(it.n), it.n > 9 ? 2.1 : 2.4, { weight: 500 });
      const room = cw - 8.5; // name column, up to the next column
      let label = it.name + (it.qty > 1 ? ` ×${it.qty}` : '');
      let size = Math.max(2.3, Math.min(2.9, room / (textWidth(label) || 1)));
      while (label.length > 2 && textWidth(label) * size > room) label = label.slice(0, -2) + '…';
      text(x + 7, yy, label, size, { anchor: 'start' });
    });
  }

  // title block: name on top, then up to 8 fields in up to 4 columns × 2 rows (no empty columns)
  const [TW, TH] = d.sheet.tb;
  const tx = W - M - TW, ty = H - M - TH;
  const shown = tableFields(fields);
  const { cols, rows } = cellGrid(shown.length);
  if (!poster) rect(tx, ty, TW, TH, 0.3, GREY);
  if (shown.length && !poster) {
    line(tx, ty + 14, tx + TW, ty + 14, 0.25, GREY);
    if (rows > 1) line(tx, ty + 25, tx + TW, ty + 25, 0.25, GREY);
    for (let i = 1; i < cols; i++) line(tx + (i * TW) / cols, ty + 14, tx + (i * TW) / cols, ty + TH, 0.25, GREY);
  }
  const titleField = fields.find((f) => f.id === 'title');
  if (!poster && (!titleField || titleField.enabled)) text(tx + 4, ty + 9, title, 4.4, { anchor: 'start', weight: 500, field: 'title' });
  if (!poster) shown.forEach((f, k) => {
    const cx = tx + (k % cols) * (TW / cols) + 2.5, cy = ty + 14 + Math.floor(k / cols) * 11;
    text(cx, cy + 3.6, f.label.toUpperCase(), 1.9, { anchor: 'start', weight: 500, fill: pal.muted, field: f.id });
    text(cx, cy + 8.6, fieldValue(f, d, sheetName), 3, { anchor: 'start', field: f.id });
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="${FONT}">` +
    `<rect width="${W}" height="${H}" fill="${pal.paper}"/>${el.join('')}</svg>`
  );
}

/** Width of a line of Geist text at font size 1 (approximate em widths), for fitting legend names. */
function textWidth(s: string) {
  let w = 0;
  for (const ch of s) w += /[ilI.,:;|'!]/.test(ch) ? 0.26 : /[mwMW]/.test(ch) ? 0.82 : /[A-Z0-9_]/.test(ch) ? 0.62 : ch === ' ' ? 0.28 : 0.52;
  return w;
}

function luminance(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** Paper mm → model mm in a view's 2D frame. */
export const toModel = (v: SheetView, P: Pt): Pt => [(P[0] - v.ox) / v.sc, (v.oy - P[1]) / v.sc];

/** A circular arc (or full circle) found in a view, in model mm. pts is the drawn edge, for highlighting. */
export type Arc = { cx: number; cy: number; r: number; pts: Pt[]; full: boolean };
export type Snap = { pt: Pt; kind: 'end' | 'corner' | 'mid' | 'centre' | 'edge' };

const TURN = Math.cos((25 * Math.PI) / 180);

/** Split a polyline into curved stretches: at corners (direction change over 25°) and around long
 *  straight segments (a fillet is line + arc + line with no corner between them). */
function curvedRuns(pl: Pt[]): Pt[][] {
  const out: Pt[][] = [];
  for (const run of runs(pl)) {
    const len = run.slice(1).map((p, i) => Math.hypot(p[0] - run[i][0], p[1] - run[i][1]));
    const sorted = [...len].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)] || 0;
    let cur: Pt[] = [run[0]];
    for (let i = 0; i < len.length; i++) {
      if (len[i] > 4 * typical && len[i] > 1e-9) {
        if (cur.length > 1) out.push(cur);
        cur = [run[i + 1]];
      } else cur.push(run[i + 1]);
    }
    if (cur.length > 1) out.push(cur);
  }
  return out;
}

/** Split a polyline at corners (direction change over 25°). */
function runs(pl: Pt[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [pl[0]];
  for (let i = 1; i < pl.length; i++) {
    cur.push(pl[i]);
    if (i < pl.length - 1) {
      const ax = pl[i][0] - pl[i - 1][0], ay = pl[i][1] - pl[i - 1][1];
      const bx = pl[i + 1][0] - pl[i][0], by = pl[i + 1][1] - pl[i][1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la > 1e-9 && lb > 1e-9 && (ax * bx + ay * by) / (la * lb) < TURN) {
        out.push(cur);
        cur = [pl[i]];
      }
    }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Least-squares circle through points (Kåsa fit). */
function fitCircle(pts: Pt[]): { cx: number; cy: number; r: number; err: number } | null {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  const n = pts.length;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] · [D E F] = −[sxz syz sz]
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], B = [-sxz, -syz, -sz];
  const det = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d = det(A);
  if (Math.abs(d) < 1e-12) return null;
  const col = (k: number) => det(A.map((row, i) => row.map((v, j) => (j === k ? B[i] : v))));
  const D = col(0) / d, E = col(1) / d, F = col(2) / d;
  const cx = -D / 2, cy = -E / 2, r2 = cx * cx + cy * cy - F;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let err = 0;
  for (const [x, y] of pts) err = Math.max(err, Math.abs(Math.hypot(x - cx, y - cy) - r));
  return { cx, cy, r, err };
}

const arcCache = new WeakMap<SheetView, Arc[]>();

/** An exact arc from HLR as an Arc: sampled from its start to its end through its middle. */
function exactArc([cx, cy, r, a0, a1, am]: number[]): Arc {
  const TAU = 2 * Math.PI;
  const norm = (a: number) => ((a % TAU) + TAU) % TAU;
  let sweep: number;
  if (Math.abs(norm(a1 - a0)) < 1e-6 || Math.abs(norm(a1 - a0) - TAU) < 1e-6) sweep = TAU; // closed: full circle
  else {
    const ccw = norm(a1 - a0);
    sweep = norm(am - a0) < ccw ? ccw : ccw - TAU; // the way round that passes the middle
  }
  const n = Math.max(8, Math.ceil((Math.abs(sweep) / TAU) * 96));
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return { cx, cy, r, pts, full: Math.abs(sweep) > TAU - 1e-6 };
}

/** Arcs and circles in a view. Exact HLR views carry every circular edge with its extent (holes,
 *  bosses and fillets, one per edge), so those are used as they are. Poly-HLR views (no curve types)
 *  fall back to circles fitted to curved stretches of the drawn edges. */
export function viewArcs(v: SheetView): Arc[] {
  const hit = arcCache.get(v);
  if (hit) return hit;
  if (v.circles.length && v.circles[0].length >= 6) {
    const out = v.circles.map(exactArc);
    arcCache.set(v, out);
    return out;
  }
  const out: Arc[] = [];
  for (const pl of v.polylines) {
    if (pl.length < 4) continue;
    for (const run of curvedRuns(pl)) {
      if (run.length < 4) continue;
      let turn = 0;
      for (let i = 1; i < run.length - 1; i++) {
        const a1 = Math.atan2(run[i][1] - run[i - 1][1], run[i][0] - run[i - 1][0]);
        const a2 = Math.atan2(run[i + 1][1] - run[i][1], run[i + 1][0] - run[i][0]);
        let da = a2 - a1;
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        turn += da;
      }
      if (Math.abs(turn) < (15 * Math.PI) / 180) continue; // straight-ish
      const c = fitCircle(run);
      if (!c || c.err > Math.max(0.03 * c.r, 0.03)) continue;
      out.push({ cx: c.cx, cy: c.cy, r: c.r, pts: run, full: Math.abs(turn) > 1.9 * Math.PI });
    }
  }
  arcCache.set(v, out);
  return out;
}

const snapCache = new WeakMap<SheetView, Snap[]>();

/** Points a dimension can snap to, in model mm: chain ends, corners, midpoints of straight edges and
 *  arc/circle centres. (Any point on an edge is the fallback, see nearestOnEdge.) */
export function snapPoints(v: SheetView): Snap[] {
  const hit = snapCache.get(v);
  if (hit) return hit;
  const out: Snap[] = [];
  for (const pl of v.polylines) {
    if (!pl.length) continue;
    out.push({ pt: pl[0], kind: 'end' }, { pt: pl[pl.length - 1], kind: 'end' });
    const rs = runs(pl);
    rs.forEach((run, k) => {
      if (k > 0) out.push({ pt: run[0], kind: 'corner' });
      if (run.length === 2) {
        const [a, b] = run;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 2) out.push({ pt: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], kind: 'mid' });
      }
    });
  }
  const centres: Pt[] = [];
  for (const a of viewArcs(v)) if (!centres.some((c) => Math.hypot(c[0] - a.cx, c[1] - a.cy) < 0.01)) centres.push([a.cx, a.cy]);
  for (const c of centres) out.push({ pt: c, kind: 'centre' });
  snapCache.set(v, out);
  return out;
}

/** Nearest point on any edge of the view (model mm), and its distance. */
export function nearestOnEdge(v: SheetView, p: Pt): { pt: Pt; d: number } | null {
  let best: Pt | null = null, bd = Infinity;
  for (const pl of v.polylines)
    for (let i = 0; i + 1 < pl.length; i++) {
      const [a, b] = [pl[i], pl[i + 1]];
      const ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2)) : 0;
      const q: Pt = [a[0] + ex * t, a[1] + ey * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) [best, bd] = [q, d];
    }
  return best ? { pt: best, d: bd } : null;
}

/** Distance from a point to an arc's drawn edge (model mm). */
export function distToArc(a: Arc, p: Pt) {
  let d = Infinity;
  for (let i = 0; i + 1 < a.pts.length; i++) {
    const [s, e] = [a.pts[i], a.pts[i + 1]];
    const ex = e[0] - s[0], ey = e[1] - s[1], L2 = ex * ex + ey * ey;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - s[0]) * ex + (p[1] - s[1]) * ey) / L2)) : 0;
    d = Math.min(d, Math.hypot(s[0] + ex * t - p[0], s[1] + ey * t - p[1]));
  }
  return d;
}

export const MEASURABLE: Exclude<ViewName, 'iso'>[] = ['front', 'top', 'right'];

/** Which measurable view a paper point lies in (its rectangle, grown by a margin). */
export function viewAt(d: DrawingData, P: Pt, margin = 6): Exclude<ViewName, 'iso'> | null {
  for (const name of MEASURABLE) {
    const v = d.views[name];
    if (!v) continue;
    const [x0, y0, x1, y1] = v.rect;
    if (P[0] >= x0 - margin && P[0] <= x1 + margin && P[1] >= y0 - margin && P[1] <= y1 + margin) return name;
  }
  return null;
}
