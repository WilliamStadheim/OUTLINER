/**
 * Light preview: the line art stays exact vector SVG, but the solid fill behind it (tens of thousands of
 * mesh triangles, same colour as the background, only there to hide the grid) is drawn once to a
 * <canvas> bitmap instead of being SVG paths. Scaling or moving a bitmap costs next to nothing, so zoom
 * and pan stay smooth; the SVG left in the DOM is just the lines (a few paths).
 */

export type FillPart = { part: number; d: string; path?: Path2D };
export type LightSvg = { html: string; parts: FillPart[]; vb: [number, number] };

const FILL_RE = /<g class="fill"[^>]*>([\s\S]*?)<\/g>/;
const PART_RE = /<path data-part="(\d+)" d="([^"]*)"\/>/g;

/** Split the API's preview SVG into the lines (kept as SVG) and the fill paths (for the canvas). */
export function splitFill(svg: string): LightSvg {
  const vbm = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const vb: [number, number] = vbm ? [Number(vbm[1]), Number(vbm[2])] : [800, 600];
  const m = FILL_RE.exec(svg);
  if (!m) return { html: svg, parts: [], vb };
  const parts: FillPart[] = [];
  for (const p of m[1].matchAll(PART_RE)) parts.push({ part: Number(p[1]), d: p[2] });
  return { html: svg.replace(FILL_RE, ''), parts, vb };
}

const path = (p: FillPart) => (p.path ??= new Path2D(p.d));

/** Where the SVG's viewBox lands inside its box (preserveAspectRatio xMidYMid meet). */
export function fitBox(boxW: number, boxH: number, vb: [number, number]) {
  const s = Math.min(boxW / vb[0], boxH / vb[1]);
  return { s, x: (boxW - vb[0] * s) / 2, y: (boxH - vb[1] * s) / 2, w: vb[0] * s, h: vb[1] * s };
}

/** Backing-store size for a fill canvas covering w CSS px: 2× device pixels, capped at 4096. */
export function backingSize(vb: [number, number], w: number) {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const k = Math.min((w / vb[0]) * dpr * 2, 4096 / Math.max(vb[0], vb[1]));
  return [Math.max(1, Math.round(vb[0] * k)), Math.max(1, Math.round(vb[1] * k))] as const;
}

/** The fill colour (the page background) and the selected part's tint (10 % accent), as 0–255 RGB. */
export function fillColours(colours: { bg: string; accent: string; line?: string }) {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const bg = rgb(ctx, colours.bg), ac = rgb(ctx, colours.accent), ln = colours.line ? rgb(ctx, colours.line) : bg;
  const mix = (o: number[], k: number) => bg.map((c, i) => Math.round(c * (1 - k) + o[i] * k)) as [number, number, number];
  // ghost: the silhouette shown while a new angle is drawn, a faint step from the background
  return { bg, tint: mix(ac, 0.1), ghost: mix(ln, 0.1), line: ln, accent: ac as [number, number, number] };
}

/** Resolve a CSS colour to #rrggbb through the canvas parser. */
function rgb(ctx: CanvasRenderingContext2D, css: string): [number, number, number] {
  ctx.fillStyle = '#000';
  ctx.fillStyle = css.trim() || '#000';
  const v = String(ctx.fillStyle);
  if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
  const n = v.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
  return [n[0], n[1], n[2]];
}

/**
 * Draw the fill into `canvas`, sized to cover the SVG's drawing area `w × h` CSS px.
 * The backing store is 2× device pixels (sharp enough when zoomed in; the fill is the background
 * colour, so soft edges don't show), capped at 4096 px.
 */
export function drawFill(
  canvas: HTMLCanvasElement,
  light: LightSvg,
  w: number,
  h: number,
  colours: { bg: string; accent: string },
  selected: number | null,
) {
  const [bw, bh] = backingSize(light.vb, w);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bw, bh);
  const bg = rgb(ctx, colours.bg), ac = rgb(ctx, colours.accent);
  const tint = bg.map((c, i) => Math.round(c * 0.9 + ac[i] * 0.1));
  ctx.setTransform(bw / light.vb[0], 0, 0, bh / light.vb[1], 0, 0);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.6; // as the SVG fill did: closes hairline cracks between triangles
  // Server order is far → near; the selected part's tint is covered by nearer parts, as before
  for (const p of light.parts) {
    const c = p.part === selected ? `rgb(${tint.join(',')})` : `rgb(${bg.join(',')})`;
    ctx.fillStyle = c;
    ctx.strokeStyle = c;
    ctx.fill(path(p));
    ctx.stroke(path(p));
  }
}

/** Nearest part whose fill covers a point given in viewBox units (for clicks inside a part). */
export function fillPartAt(light: LightSvg, x: number, y: number): number | null {
  if (typeof document === 'undefined') return null;
  const ctx = (fillPartAt as { ctx?: CanvasRenderingContext2D | null }).ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return null;
  for (let i = light.parts.length - 1; i >= 0; i--) if (ctx.isPointInPath(path(light.parts[i]), x, y)) return light.parts[i].part;
  return null;
}

// ---------- fill from the mesh (sent once per file), projected here for every angle

export type ScenePart = {
  part: number;
  nodes: Float32Array; // fine mesh, model mm
  tris: Uint32Array;
  fids: Uint32Array; // face id per triangle (silhouettes are found inside a face)
  edgeLens: Uint32Array; // points per real edge polyline
  edgePts: Float32Array; // the real B-rep edges that exact HLR draws, model mm
  centre: [number, number, number];
};
export type FillMesh = ScenePart[];
type Frame = { x0: number; y1: number; s: number; pad: number; d: number[]; x: number[] };
export type ProjectedFill = { part: number; xy: Float32Array; tris: Uint32Array }[];

/** Parse the /api/scene payload (see api/index.py). */
export function parseFillMesh(buf: ArrayBuffer): FillMesh {
  const u = new Uint32Array(buf);
  const out: FillMesh = [];
  let o = 1;
  for (let k = 0; k < u[0]; k++) {
    const [part, nn, nt, ne, np] = [u[o], u[o + 1], u[o + 2], u[o + 3], u[o + 4]];
    o += 5;
    const centre = Array.from(new Float32Array(buf, o * 4, 3)) as [number, number, number];
    o += 3;
    const nodes = new Float32Array(buf, o * 4, nn * 3);
    o += nn * 3;
    const tris = new Uint32Array(buf, o * 4, nt * 3);
    o += nt * 3;
    const fids = new Uint32Array(buf, o * 4, nt);
    o += nt;
    const edgeLens = new Uint32Array(buf, o * 4, ne);
    o += ne;
    const edgePts = new Float32Array(buf, o * 4, np * 3);
    o += np * 3;
    out.push({ part, nodes, tris, fids, edgeLens, edgePts, centre });
  }
  return out;
}

/** The SVG's model → viewBox mapping (data-frame, data-camera written by outliner_core.render). */
export function svgFrame(svg: string): Frame | null {
  const f = /data-frame="([^"]+)"/.exec(svg)?.[1]?.split(' ').map(Number);
  const c = /data-camera="([^"]+)"/.exec(svg)?.[1]?.split(' ').map(Number);
  if (!f || !c || f.length < 4 || c.length < 6) return null;
  return { x0: f[0], y1: f[1], s: f[2], pad: f[3], d: c.slice(0, 3), x: c.slice(3, 6) };
}

/** Project the drawn parts' triangles into viewBox units, far → near (as the server did). */
export function projectFill(mesh: FillMesh, fr: Frame, drawn: Set<number>, offsets?: Record<number, number[]>): ProjectedFill {
  const [dx, dy, dz] = fr.d, [xx, xy, xz] = fr.x;
  const yx = dy * xz - dz * xy, yy = dz * xx - dx * xz, yz = dx * xy - dy * xx; // y = d × x
  return mesh
    .filter((m) => drawn.has(m.part) && m.tris.length)
    .sort((a, b) => a.centre[0] * dx + a.centre[1] * dy + a.centre[2] * dz - (b.centre[0] * dx + b.centre[1] * dy + b.centre[2] * dz))
    .map((m) => {
      const n = m.nodes, xyArr = new Float32Array((n.length / 3) * 2);
      const [ox, oy, oz] = offsets?.[m.part] ?? [0, 0, 0];
      const ou = ox * xx + oy * xy + oz * xz, ov = ox * yx + oy * yy + oz * yz;
      for (let i = 0, j = 0; i < n.length; i += 3, j += 2) {
        xyArr[j] = (n[i] * xx + n[i + 1] * xy + n[i + 2] * xz + ou - fr.x0) * fr.s + fr.pad;
        xyArr[j + 1] = (fr.y1 - (n[i] * yx + n[i + 1] * yy + n[i + 2] * yz + ov)) * fr.s + fr.pad;
      }
      return { part: m.part, xy: xyArr, tris: m.tris };
    });
}

function trianglesPath(p: { xy: Float32Array; tris: Uint32Array }) {
  // One path string parsed natively: building a Path2D call by call is ~50x slower in Chrome
  const P = p.xy, T = p.tris, out: string[] = [];
  const f = (v: number) => v.toFixed(2);
  for (let i = 0; i < T.length; i += 3) {
    const a = T[i] * 2, b = T[i + 1] * 2, c = T[i + 2] * 2;
    const area = (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[b + 1] - P[a + 1]) * (P[c] - P[a]);
    if (Math.abs(area) < 1e-9) continue;
    // one winding for all, so overlapping triangles never cancel under the nonzero rule
    const [q, r] = area > 0 ? [b, c] : [c, b];
    out.push(`M${f(P[a])} ${f(P[a + 1])}L${f(P[q])} ${f(P[q + 1])}L${f(P[r])} ${f(P[r + 1])}Z`);
  }
  return new Path2D(out.join(''));
}

/** drawFill for a projected mesh. */
export function drawProjectedFill(
  canvas: HTMLCanvasElement,
  fill: ProjectedFill,
  vb: [number, number],
  w: number,
  colours: { bg: string; accent: string },
  selected: number | null,
) {
  const parts: FillPart[] = fill.map((p) => ({ part: p.part, d: '', path: trianglesPath(p) }));
  drawFill(canvas, { html: '', parts, vb }, w, 0, colours, selected);
}

/**
 * Exploded view: each part moved away from the assembly's centre, along the line from the centre to the
 * part's centre, by `spread` (0–1) × 2.5 × that distance. Parts at the centre stay put.
 */
export function autoExplode(mesh: FillMesh, spread: number): Record<number, number[]> {
  const ps = mesh.filter((m) => m.tris.length);
  if (ps.length < 2) return {};
  const C = [0, 1, 2].map((k) => ps.reduce((t, m) => t + m.centre[k], 0) / ps.length);
  const out: Record<number, number[]> = {};
  for (const m of ps) out[m.part] = [0, 1, 2].map((k) => (m.centre[k] - C[k]) * spread * 2.5);
  return out;
}

/** Nearest part whose projected triangles cover (x, y) in viewBox units. */
export function projectedPartAt(fill: ProjectedFill, x: number, y: number): number | null {
  for (let k = fill.length - 1; k >= 0; k--) {
    const P = fill[k].xy, T = fill[k].tris;
    for (let i = 0; i < T.length; i += 3) {
      const a = T[i] * 2, b = T[i + 1] * 2, c = T[i + 2] * 2;
      const d1 = (x - P[b]) * (P[a + 1] - P[b + 1]) - (P[a] - P[b]) * (y - P[b + 1]);
      const d2 = (x - P[c]) * (P[b + 1] - P[c + 1]) - (P[b] - P[c]) * (y - P[c + 1]);
      const d3 = (x - P[a]) * (P[c + 1] - P[a + 1]) - (P[c] - P[a]) * (y - P[a + 1]);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return fill[k].part;
    }
  }
  return null;
}

/**
 * While a new angle is being drawn: the frame for showing the fill mesh alone at that angle, fitted
 * the way the server fits the lines (800 wide, 8 px pad), so the silhouette turns at once and the exact
 * lines land on it when they arrive.
 */
export function placeholderFrame(mesh: FillMesh, cam: { d: number[]; x: number[] }, drawn: Set<number>, offsets?: Record<number, number[]>) {
  const [dx, dy, dz] = cam.d, [xx, xy, xz] = cam.x;
  const yx = dy * xz - dz * xy, yy = dz * xx - dx * xz, yz = dx * xy - dy * xx;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const m of mesh) {
    if (!drawn.has(m.part)) continue;
    const n = m.nodes;
    const [ox, oy, oz] = offsets?.[m.part] ?? [0, 0, 0];
    const ou = ox * xx + oy * xy + oz * xz, ov = ox * yx + oy * yy + oz * yz;
    for (let i = 0; i < n.length; i += 3) {
      const u = n[i] * xx + n[i + 1] * xy + n[i + 2] * xz + ou, v = n[i] * yx + n[i + 1] * yy + n[i + 2] * yz + ov;
      if (u < x0) x0 = u;
      if (u > x1) x1 = u;
      if (v < y0) y0 = v;
      if (v > y1) y1 = v;
    }
  }
  if (!isFinite(x0)) return null;
  const pad = 8, s = (800 - 2 * pad) / Math.max(x1 - x0, 1e-6);
  return { fr: { x0, y1, s, pad, d: cam.d, x: cam.x }, vb: [800, (y1 - y0) * s + 2 * pad] as [number, number] };
}
