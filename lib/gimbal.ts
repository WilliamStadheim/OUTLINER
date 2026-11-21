// Gimbal graphic for the Orientation card. Based on DESIGN.md → "Gimbal (orientation card)", but
// projected with the exact ISO camera of the backend so the cube always matches the drawing.
// Back halves of the rings are dashed and drawn first, then the cube, then the front halves.

const COL = { x: '#FF5656', y: '#58D678', z: '#528CFF' };
type V3 = [number, number, number];

export function gimbalSVG(R: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], W = 220, H = 190, s = 20, ringPx = 54) {
  const cx = W / 2, cy = H / 2, Rr = ringPx / s;
  const rot = (q: V3): V3 => [0, 1, 2].map((i) => R[i][0] * q[0] + R[i][1] * q[1] + R[i][2] * q[2]) as V3;
  // Same orthographic ISO camera as the backend (outliner_core VIEWS['iso']):
  // view dir d = (1,-1,1)/√3, screen-x = (1,1,0)/√2, screen-up = d × x = (-1,1,2)/√6.
  const SX: V3 = [Math.SQRT1_2, Math.SQRT1_2, 0];
  const SU: V3 = [-1 / Math.sqrt(6), 1 / Math.sqrt(6), 2 / Math.sqrt(6)];
  const D: V3 = [1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const P = (q: V3) => { const p = rot(q); return [cx + s * dot(p, SX), cy - s * dot(p, SU)]; };
  const depth = (q: V3) => dot(rot(q), D); // > 0 = towards viewer
  const f = (p: number[]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

  // rings: plane perpendicular to each axis
  const planes: Record<'x' | 'y' | 'z', [V3, V3]> = { x: [[0, 1, 0], [0, 0, 1]], y: [[1, 0, 0], [0, 0, 1]], z: [[1, 0, 0], [0, 1, 0]] };
  let back = '', front = '';
  for (const k of ['x', 'y', 'z'] as const) {
    const [u, w] = planes[k]; let solid = '', dash = ''; const N = 200;
    const pt = (t: number): V3 => { const a = t * 2 * Math.PI; return [0, 1, 2].map((j) => Rr * (Math.cos(a) * u[j] + Math.sin(a) * w[j])) as V3; };
    for (let i = 0; i < N; i++) {
      const a = pt(i / N), b = pt((i + 1) / N), m = a.map((v, j) => (v + b[j]) / 2) as V3;
      const seg = `M${f(P(a))} L${f(P(b))} `;
      if (depth(m) < 0) dash += seg; else solid += seg;
    }
    back += `<path d="${dash}" stroke="${COL[k]}" stroke-opacity="0.45" stroke-width="1.6" stroke-dasharray="2 3" fill="none"/>`;
    front += `<path d="${solid}" stroke="${COL[k]}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`;
  }

  // cube [-1,1]^3: draw the 3 faces whose normal points to the viewer
  const faces: { n: V3; pts: V3[]; tint: number }[] = [
    { n: [0, 0, 1], pts: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], tint: 0.08 },
    { n: [0, 0, -1], pts: [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]], tint: 0.08 },
    { n: [0, -1, 0], pts: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], tint: 0.05 },
    { n: [0, 1, 0], pts: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], tint: 0.05 },
    { n: [1, 0, 0], pts: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], tint: 0.03 },
    { n: [-1, 0, 0], pts: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], tint: 0.03 },
  ];
  let cube = '';
  for (const fc of faces) if (depth(fc.n) > 1e-6) {
    const pts = fc.pts.map((q) => f(P(q))).join(' ');
    cube += `<polygon points="${pts}" fill="#242426"/><polygon points="${pts}" fill="#FFFFFF" fill-opacity="${fc.tint}" stroke="#C7C7CC" stroke-opacity="0.7" stroke-width="1" stroke-linejoin="round"/>`;
  }
  // silhouette: convex hull of the 8 projected corners, 1.7px white
  const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => P([x, y, z] as V3))));
  cube += `<polygon points="${hull(corners).map(f).join(' ')}" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linejoin="round"/>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${back}${cube}${front}</svg>`;
}

function hull(p: number[][]) { // monotone chain
  const pts = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: number[][] = [], up: number[][] = [];
  for (const q of pts) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of pts.reverse()) { while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
