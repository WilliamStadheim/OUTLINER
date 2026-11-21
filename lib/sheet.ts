// Production drawing sheet, built in the browser as SVG (millimetre units). The same string is shown
// in the preview and downloaded (SVG, or turned into PDF), so what you see is what you get.
//
// The views are exact HLR polylines in model mm from /api/drawing; the server decides where each view
// goes (paper x = ox + x·sc, paper y = oy − y·sc). Style from the production-drawing-a4 skill.

export type ViewName = 'front' | 'top' | 'right' | 'iso';
export type Pt = [number, number];

export type SheetView = {
  ox: number;
  oy: number;
  sc: number;
  rect: [number, number, number, number]; // paper mm: x0, y0, x1, y1
  bbox: [number, number, number, number]; // model mm: x0, y0, x1, y1
  polylines: Pt[][];
  circles: [number, number, number][]; // model mm: cx, cy, r
};

export type DrawingData = {
  sheet: { w: number; h: number; margin: number; tb: [number, number] };
  scale: number;
  scaleLabel: string;
  autoScale: string;
  options: Record<'1:1' | '2:1', boolean>;
  layout: string;
  dropped: string[];
  views: Partial<Record<ViewName, SheetView>>;
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

export const LINE = 0.35; // visible contours
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

  if (dim.kind === 'diameter' || dim.kind === 'radius') {
    const r = dim.b[0] * v.sc, ang = dim.b[1];
    const ux = Math.cos(ang), uy = -Math.sin(ang);
    const P0 = dim.kind === 'diameter' ? [A[0] - ux * r, A[1] - uy * r] : A;
    const P1 = [A[0] + ux * r, A[1] + uy * r];
    const tx = A[0] + ux * (r + 2 + dim.offset), ty = A[1] + uy * (r + 2 + dim.offset);
    return `<g data-dim="${dim.id}">${line(P0[0], P0[1], P1[0], P1[1])}${line(P1[0], P1[1], tx, ty)}${text(tx + (ux >= 0 ? 4 : -4), ty - 0.8, label)}</g>`;
  }

  const B = toPaper(v, dim.b);
  let s = '';
  if (dim.kind === 'h') {
    const yd = (dim.offset >= 0 ? Math.max(A[1], B[1]) : Math.min(A[1], B[1])) + dim.offset;
    const g = dim.offset >= 0 ? 1 : -1;
    for (const P of [A, B]) s += line(P[0], P[1] + g * 1, P[0], yd + g * 1.5);
    s += line(A[0], yd, B[0], yd) + text((A[0] + B[0]) / 2, yd - 1, label);
  } else if (dim.kind === 'v') {
    const xd = (dim.offset >= 0 ? Math.max(A[0], B[0]) : Math.min(A[0], B[0])) + dim.offset;
    const g = dim.offset >= 0 ? 1 : -1;
    for (const P of [A, B]) s += line(P[0] + g * 1, P[1], xd + g * 1.5, P[1]);
    s += line(xd, A[1], xd, B[1]) + text(xd - 1, (A[1] + B[1]) / 2, label, -90);
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
    const mx = (A2[0] + B2[0]) / 2 + Math.sin(r) * 1, my = (A2[1] + B2[1]) / 2 - Math.cos(r) * 1;
    s += line(A2[0], A2[1], B2[0], B2[1]) + text(mx, my, label, deg);
  }
  return `<g data-dim="${dim.id}">${s}</g>`;
}

/** Title block cell rectangles (paper mm), for the editing highlight. */
export function titleCells(d: DrawingData, fields: TitleField[]) {
  const [TW, TH] = d.sheet.tb;
  const tx = d.sheet.w - d.sheet.margin - TW, ty = d.sheet.h - d.sheet.margin - TH;
  const cells: Record<string, [number, number, number, number]> = { title: [tx, ty, TW, 14] };
  fields
    .filter((f) => f.enabled && f.id !== 'title')
    .slice(0, 8)
    .forEach((f, k) => {
      cells[f.id] = [tx + (k % 4) * (TW / 4), ty + 14 + Math.floor(k / 4) * 11, TW / 4, 11];
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
export function buildSheet(d: DrawingData, fields: TitleField[], dims: Dim[], sheetName: string, title: string): string {
  const { w: W, h: H, margin: M } = d.sheet;
  const el: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, sw: number, col: string) =>
    el.push(`<rect x="${f3(x)}" y="${f3(y)}" width="${f3(w)}" height="${f3(h)}" fill="none" stroke="${col}" stroke-width="${sw}"/>`);
  const line = (x1: number, y1: number, x2: number, y2: number, sw: number, col: string) =>
    el.push(`<line x1="${f3(x1)}" y1="${f3(y1)}" x2="${f3(x2)}" y2="${f3(y2)}" stroke="${col}" stroke-width="${sw}"/>`);
  const text = (x: number, y: number, t: string, size: number, opts: { anchor?: string; weight?: number; fill?: string; field?: string } = {}) =>
    el.push(
      `<text x="${f3(x)}" y="${f3(y)}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? '#000'}" text-anchor="${
        opts.anchor ?? 'middle'
      }"${opts.field ? ` data-field="${opts.field}"` : ''}>${esc(t)}</text>`,
    );

  rect(M, M, W - 2 * M, H - 2 * M, 0.3, GREY);

  // views
  const label = { size: 3, weight: 500 };
  for (const name of ['front', 'top', 'right', 'iso'] as ViewName[]) {
    const v = d.views[name];
    if (!v) continue;
    const dd = v.polylines
      .map((pl) => 'M' + pl.map((p) => `${f3(v.ox + p[0] * v.sc)} ${f3(v.oy - p[1] * v.sc)}`).join('L'))
      .join('');
    el.push(
      `<path data-view="${name}" d="${dd}" fill="none" stroke="#000" stroke-width="${name === 'iso' ? f3(LINE * 0.9) : LINE}" stroke-linecap="round" stroke-linejoin="round"/>`,
    );
    const [x0, y0, x1, y1] = v.rect;
    const cx = (x0 + x1) / 2;
    if (name === 'top') text(cx, y0 - 5, 'TOP', label.size, { weight: label.weight });
    else if (name === 'iso') text(cx, y1 + 8, 'ISO', label.size, { weight: label.weight });
    else text(cx, y1 + 17.5, name.toUpperCase(), label.size, { weight: label.weight });
  }

  // dimensions
  for (const dim of dims) el.push(dimSVG(d, dim));

  // title block: name on top, then up to 8 fields in 4 columns
  const [TW, TH] = d.sheet.tb;
  const tx = W - M - TW, ty = H - M - TH;
  rect(tx, ty, TW, TH, 0.3, GREY);
  line(tx, ty + 14, tx + TW, ty + 14, 0.25, GREY);
  line(tx, ty + 25, tx + TW, ty + 25, 0.25, GREY);
  for (let i = 1; i < 4; i++) line(tx + (i * TW) / 4, ty + 14, tx + (i * TW) / 4, ty + TH, 0.25, GREY);
  const titleField = fields.find((f) => f.id === 'title');
  if (!titleField || titleField.enabled) text(tx + 4, ty + 9, title, 4.4, { anchor: 'start', weight: 500, field: 'title' });
  fields
    .filter((f) => f.enabled && f.id !== 'title')
    .slice(0, 8)
    .forEach((f, k) => {
      const cx = tx + (k % 4) * (TW / 4) + 2.5, cy = ty + 14 + Math.floor(k / 4) * 11;
      text(cx, cy + 3.6, f.label.toUpperCase(), 1.9, { anchor: 'start', weight: 500, fill: '#8A8A8A', field: f.id });
      text(cx, cy + 8.6, fieldValue(f, d, sheetName), 3, { anchor: 'start', field: f.id });
    });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="${FONT}">` +
    `<rect width="${W}" height="${H}" fill="#fff"/>${el.join('')}</svg>`
  );
}

/** Paper mm → model mm in a view's 2D frame. */
export const toModel = (v: SheetView, P: Pt): Pt => [(P[0] - v.ox) / v.sc, (v.oy - P[1]) / v.sc];

/** Points a dimension can snap to, in model mm: ends of every edge chain, corners inside chains
 *  (direction change over 20°) and circle centres. Curves only contribute their ends. */
export function snapPoints(v: SheetView): Pt[] {
  const out: Pt[] = [];
  const cosLimit = Math.cos((20 * Math.PI) / 180);
  for (const pl of v.polylines) {
    if (!pl.length) continue;
    out.push(pl[0], pl[pl.length - 1]);
    for (let i = 1; i < pl.length - 1; i++) {
      const ax = pl[i][0] - pl[i - 1][0], ay = pl[i][1] - pl[i - 1][1];
      const bx = pl[i + 1][0] - pl[i][0], by = pl[i + 1][1] - pl[i][1];
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la > 1e-9 && lb > 1e-9 && (ax * bx + ay * by) / (la * lb) < cosLimit) out.push(pl[i]);
    }
  }
  for (const c of v.circles) out.push([c[0], c[1]]);
  return out;
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
