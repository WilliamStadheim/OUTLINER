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
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const k = Math.min((w / light.vb[0]) * dpr * 2, 4096 / Math.max(light.vb[0], light.vb[1]));
  const bw = Math.max(1, Math.round(light.vb[0] * k)), bh = Math.max(1, Math.round(light.vb[1] * k));
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
