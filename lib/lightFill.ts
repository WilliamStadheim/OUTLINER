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
export function fillColours(colours: { bg: string; accent: string }) {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const bg = rgb(ctx, colours.bg), ac = rgb(ctx, colours.accent);
  return { bg, tint: bg.map((c, i) => Math.round(c * 0.9 + ac[i] * 0.1)) as [number, number, number] };
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

export type FillMesh = { part: number; nodes: Float32Array; tris: Uint32Array; centre: [number, number, number] }[];
type Frame = { x0: number; y1: number; s: number; pad: number; d: number[]; x: number[] };
export type ProjectedFill = { part: number; xy: Float32Array; tris: Uint32Array }[];

/** Parse the /api/fill payload (see api/index.py). */
export function parseFillMesh(buf: ArrayBuffer): FillMesh {
  const u = new Uint32Array(buf);
  const out: FillMesh = [];
  let o = 1;
  for (let k = 0; k < u[0]; k++) {
    const part = u[o], nn = u[o + 1], nt = u[o + 2];
    o += 3;
    const centre = Array.from(new Float32Array(buf, o * 4, 3)) as [number, number, number];
    o += 3;
    const nodes = new Float32Array(buf, o * 4, nn * 3);
    o += nn * 3;
    const tris = new Uint32Array(buf, o * 4, nt * 3);
    o += nt * 3;
    out.push({ part, nodes, tris, centre });
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
export function projectFill(mesh: FillMesh, fr: Frame, drawn: Set<number>): ProjectedFill {
  const [dx, dy, dz] = fr.d, [xx, xy, xz] = fr.x;
  const yx = dy * xz - dz * xy, yy = dz * xx - dx * xz, yz = dx * xy - dy * xx; // y = d × x
  return mesh
    .filter((m) => drawn.has(m.part) && m.tris.length)
    .sort((a, b) => a.centre[0] * dx + a.centre[1] * dy + a.centre[2] * dz - (b.centre[0] * dx + b.centre[1] * dy + b.centre[2] * dz))
    .map((m) => {
      const n = m.nodes, xyArr = new Float32Array((n.length / 3) * 2);
      for (let i = 0, j = 0; i < n.length; i += 3, j += 2) {
        xyArr[j] = (n[i] * xx + n[i + 1] * xy + n[i + 2] * xz - fr.x0) * fr.s + fr.pad;
        xyArr[j + 1] = (fr.y1 - (n[i] * yx + n[i + 1] * yy + n[i + 2] * yz)) * fr.s + fr.pad;
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
