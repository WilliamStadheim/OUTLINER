export type View = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export type Rot = [number, number, number];
export type Axis = 'x' | 'y' | 'z';

/** Same order and labels as the Views card. `meta` is the direction the viewer looks from. */
export const VIEWS: { id: View; label: string; meta: string }[] = [
  { id: 'iso', label: 'ISO', meta: '' },
  { id: 'front', label: 'Front', meta: '−Y' },
  { id: 'back', label: 'Back', meta: '+Y' },
  { id: 'left', label: 'Left', meta: '−X' },
  { id: 'right', label: 'Right', meta: '+X' },
  { id: 'top', label: 'Top', meta: '+Z' },
  { id: 'bottom', label: 'Bottom', meta: '−Z' },
];

export const AXIS_COLOR: Record<Axis, string> = { x: '#FF5656', y: '#58D678', z: '#528CFF' };

/** Degrees about model X, then Y, then Z: R = Rz·Ry·Rx. Same as rotation_matrix() in outliner_core.py. */
export function rotationMatrix([x, y, z]: Rot): number[][] {
  const r = Math.PI / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x * r), Math.sin(x * r), Math.cos(y * r), Math.sin(y * r), Math.cos(z * r), Math.sin(z * r)];
  const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
  const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
  const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
  const mul = (A: number[][], B: number[][]) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
  return mul(Rz, mul(Ry, Rx));
}

/** Wrap to (−180, 180]. */
export function wrapAngle(a: number): number {
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

export function formatAngle(a: number): string {
  if (a === 0) return '0°';
  return `${a > 0 ? '+' : '−'}${Math.abs(a)}°`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** View direction and screen-right axis, as in outliner_core.VIEWS. */
const CAMERA: Record<View, [number[], number[]]> = {
  iso: [[1, -1, 1], [1, 1, 0]],
  front: [[0, -1, 0], [1, 0, 0]],
  back: [[0, 1, 0], [-1, 0, 0]],
  left: [[-1, 0, 0], [0, -1, 0]],
  right: [[1, 0, 0], [0, 1, 0]],
  top: [[0, 0, 1], [1, 0, 0]],
  bottom: [[0, 0, -1], [1, 0, 0]],
};

/** Same as outliner_core.camera_key: rotations/views that give the same camera share a drawing. */
export function cameraKey(view: View, rot: Rot): string {
  const R = rotationMatrix(rot);
  const tr = (v: number[]) => {
    const n = Math.hypot(...v);
    return [0, 1, 2].map((j) => (R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2]) / n); // Rᵀ·v
  };
  const [d, x] = CAMERA[view];
  return [...tr(d), ...tr(x)].map((v) => (Math.round(v * 1e6) / 1e6 || 0).toFixed(6)).join(',');
}

/** View direction d and screen-right x in model coordinates (outliner_core.camera, without rounding). */
export function cameraVectors(view: View, rot: Rot): { d: number[]; x: number[] } {
  const R = rotationMatrix(rot);
  const tr = (v: number[]) => {
    const n = Math.hypot(...v);
    return [0, 1, 2].map((j) => (R[0][j] * v[0] + R[1][j] * v[1] + R[2][j] * v[2]) / n); // Rᵀ·v
  };
  const [d, x] = CAMERA[view];
  return { d: tr(d), x: tr(x) };
}
