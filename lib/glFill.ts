/**
 * The preview on the GPU (WebGL2), from the scene sent once per file (fine mesh + real B-rep edges).
 *
 *  - Fill: the mesh in the background colour, under the exact SVG lines. Uploaded once; a new angle only
 *    changes a few uniforms. MSAA keeps shared triangle edges watertight.
 *  - Lines (while the exact drawing for a new angle is being computed): the model's real edges, and the
 *    silhouettes of curved faces from the fine mesh, projected with the same camera; what is hidden is
 *    decided by a real depth buffer of the real geometry (the mesh is pushed back a hair with polygon
 *    offset so edges lying on visible faces pass). Correct geometry at screen resolution, like a CAD
 *    viewport; the exact HLR drawing replaces it when it arrives.
 */
import type { FillMesh } from './lightFill';

type Frame = { x0: number; y1: number; s: number; pad: number; d: number[]; x: number[] };
type GPart = {
  part: number;
  centre: [number, number, number];
  triVao: WebGLVertexArrayObject;
  triCount: number;
  edgeVao: WebGLVertexArrayObject;
  edgeCount: number; // segments
  // silhouette candidates: mesh edges inside a face whose two triangles have different normals
  sil: { a: Float32Array; b: Float32Array; n1: Float32Array; n2: Float32Array; count: number };
};

const COMMON = `
uniform vec3 uX, uY, uD;    // screen right / up / towards the viewer, in model space
uniform vec4 uMap;          // x0, y1, s, pad   (svg x = (p·X − x0)·s + pad, svg y = (y1 − p·Y)·s + pad)
uniform vec2 uVB;           // viewBox width, height
uniform vec2 uDepth;        // nearest, farthest p·D
vec4 clipOf(vec3 p) {
  vec2 q = vec2((dot(p, uX) - uMap.x) * uMap.z + uMap.w, (uMap.y - dot(p, uY)) * uMap.z + uMap.w);
  float z = (uDepth.x - dot(p, uD)) / (uDepth.x - uDepth.y) * 2.0 - 1.0;   // near −1 … far +1
  return vec4(q.x / uVB.x * 2.0 - 1.0, 1.0 - q.y / uVB.y * 2.0, z, 1.0);
}`;
const VS_TRI = `#version 300 es
in vec3 p;${COMMON}
void main() { gl_Position = clipOf(p); }`;
// a segment p0→p1 drawn as a quad of uWidth pixels (WebGL lines are 1 px only)
const VS_LINE = `#version 300 es
in vec3 p0; in vec3 p1; in vec2 corner;  // corner.x: 0 = p0 end, 1 = p1 end; corner.y: −1 / +1 side
uniform vec2 uPx;                        // canvas size in pixels
uniform float uWidth;
uniform float uBias;                     // model mm towards the viewer: an edge on a curved face may lie a
                                         // hair behind the mesh's chords (far less than a sheet's thickness)${COMMON}
void main() {
  vec4 a = clipOf(p0 + uD * uBias), b = clipOf(p1 + uD * uBias);
  vec2 dir = (b.xy - a.xy) * uPx;
  dir = length(dir) > 1e-6 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x) * uWidth / uPx;
  vec4 c = mix(a, b, corner.x);
  c.xy += n * corner.y + dir * (corner.x * 2.0 - 1.0) * uWidth * 0.5 / uPx;  // round-ish caps
  gl_Position = c;
}`;
const FS = `#version 300 es
precision mediump float;
uniform vec4 uColour;
out vec4 o;
void main() { o = uColour; }`;

function program(gl: WebGL2RenderingContext, vs: string, attrs: string[]) {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
  attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  const u = (n: string) => gl.getUniformLocation(p, n);
  return { p, u: Object.fromEntries(['uX', 'uY', 'uD', 'uMap', 'uVB', 'uDepth', 'uColour', 'uPx', 'uWidth', 'uBias'].map((n) => [n, u(n)])) };
}

export class GLFill {
  private gl: WebGL2RenderingContext;
  private tri: ReturnType<typeof program>;
  private line: ReturnType<typeof program>;
  private corners: WebGLBuffer;
  private parts: GPart[] = [];
  private buffers: WebGLBuffer[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  private silVao: WebGLVertexArrayObject;
  private silBuf: WebGLBuffer;
  private mesh: FillMesh | null = null;
  private radius = 1;
  private centre = [0, 0, 0];

  static create(canvas: HTMLCanvasElement): GLFill | null {
    const gl = canvas.getContext('webgl2', { antialias: true, depth: true, premultipliedAlpha: true, alpha: true });
    if (!gl) return null;
    try {
      return new GLFill(gl);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.tri = program(gl, VS_TRI, ['p']);
    this.line = program(gl, VS_LINE, ['p0', 'p1', 'corner']);
    // the quad's 4 corners (two triangles as a strip), shared by every segment instance
    this.corners = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    this.silBuf = gl.createBuffer()!;
    this.silVao = this.segmentVao(this.silBuf);
  }

  get canvas() {
    return this.gl.canvas as HTMLCanvasElement;
  }

  /** A VAO drawing instanced segments from a buffer of [p0 xyz, p1 xyz] per segment. */
  private segmentVao(buf: WebGLBuffer) {
    const gl = this.gl, vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.vertexAttribDivisor(1, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.corners);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  /** Upload a file's scene once (no-op for the same scene). */
  setMesh(mesh: FillMesh) {
    if (mesh === this.mesh) return;
    const gl = this.gl;
    for (const b of this.buffers) gl.deleteBuffer(b);
    for (const v of this.vaos) gl.deleteVertexArray(v);
    this.buffers = [];
    this.vaos = [];
    this.parts = [];
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const m of mesh) {
      if (!m.tris.length && !m.edgeLens.length) continue;
      const n = m.nodes;
      for (let i = 0; i < n.length; i += 3)
        for (let k = 0; k < 3; k++) {
          if (n[i + k] < lo[k]) lo[k] = n[i + k];
          if (n[i + k] > hi[k]) hi[k] = n[i + k];
        }
      // triangles
      const triVao = gl.createVertexArray()!;
      gl.bindVertexArray(triVao);
      const vb = gl.createBuffer()!, ib = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, m.nodes, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.tris, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      // real edges → segments
      let nseg = 0;
      for (const len of m.edgeLens) nseg += Math.max(0, len - 1);
      const seg = new Float32Array(nseg * 6), E = m.edgePts;
      let o = 0, start = 0;
      for (const len of m.edgeLens) {
        for (let i = 0; i + 1 < len; i++) {
          const a = (start + i) * 3, b = a + 3;
          seg.set([E[a], E[a + 1], E[a + 2], E[b], E[b + 1], E[b + 2]], o);
          o += 6;
        }
        start += len;
      }
      const eb = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, eb);
      gl.bufferData(gl.ARRAY_BUFFER, seg, gl.STATIC_DRAW);
      const edgeVao = this.segmentVao(eb);
      this.buffers.push(vb, ib, eb);
      this.vaos.push(triVao, edgeVao);
      this.parts.push({ part: m.part, centre: m.centre, triVao, triCount: m.tris.length, edgeVao, edgeCount: nseg, sil: silhouetteCandidates(m) });
    }
    this.centre = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
    this.radius = Math.max(1e-6, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
    this.mesh = mesh;
  }

  /**
   * Draw the drawn parts. fill: background colour (+ tint for the selected part).
   * lines: if given, also the real edges and silhouettes, with hidden ones removed by depth.
   */
  draw(
    fr: Frame,
    vb: [number, number],
    drawn: Set<number>,
    colour: [number, number, number],
    tint: [number, number, number],
    selected: number | null,
    lines?: { colour: [number, number, number]; selected: [number, number, number]; widthPx: number },
  ) {
    const gl = this.gl, c = gl.canvas as HTMLCanvasElement;
    const [dx, dy, dz] = fr.d, [xx, xy, xz] = fr.x;
    const Y = [dy * xz - dz * xy, dz * xx - dx * xz, dx * xy - dy * xx];
    const cd = this.centre[0] * dx + this.centre[1] * dy + this.centre[2] * dz;
    const depth = [cd + this.radius * 1.01, cd - this.radius * 1.01];
    const parts = this.parts.filter((q) => drawn.has(q.part));
    const set = (pr: ReturnType<typeof program>) => {
      gl.useProgram(pr.p);
      gl.uniform3f(pr.u.uX, xx, xy, xz);
      gl.uniform3f(pr.u.uY, Y[0], Y[1], Y[2]);
      gl.uniform3f(pr.u.uD, dx, dy, dz);
      gl.uniform4f(pr.u.uMap, fr.x0, fr.y1, fr.s, fr.pad);
      gl.uniform2f(pr.u.uVB, vb[0], vb[1]);
      gl.uniform2f(pr.u.uDepth, depth[0], depth[1]);
    };
    const rgba = (pr: ReturnType<typeof program>, col: number[]) => gl.uniform4f(pr.u.uColour, col[0] / 255, col[1] / 255, col[2] / 255, 1);

    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // fill, pushed back a hair so edges lying on visible faces pass the depth test
    set(this.tri);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 4);
    for (const p of parts) {
      rgba(this.tri, p.part === selected ? tint : colour);
      gl.bindVertexArray(p.triVao);
      gl.drawElements(gl.TRIANGLES, p.triCount, gl.UNSIGNED_INT, 0); // triCount = indices (3 per triangle)
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);

    if (lines) {
      set(this.line);
      gl.uniform2f(this.line.u.uPx, c.width, c.height);
      gl.uniform1f(this.line.u.uBias, this.radius / 1500); // the mesh's chord error is ≤ diagonal/2000
      for (const p of parts) {
        const sel = p.part === selected;
        rgba(this.line, sel ? lines.selected : lines.colour);
        gl.uniform1f(this.line.u.uWidth, lines.widthPx * (sel ? 1.5 : 1));
        gl.bindVertexArray(p.edgeVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, p.edgeCount);
        // silhouettes of curved faces for this view
        const s = silhouettes(p.sil, dx, dy, dz);
        if (s.length) {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.silBuf);
          gl.bufferData(gl.ARRAY_BUFFER, s, gl.STREAM_DRAW);
          gl.bindVertexArray(this.silVao);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.length / 6);
        }
      }
    }
    gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }
}

/** Mesh edges inside one face whose two triangles are not coplanar: where the view direction crosses
 *  from one normal's side to the other's, that edge is on the face's silhouette (outline). */
function silhouetteCandidates(m: FillMesh[number]) {
  const N = m.nodes, T = m.tris, F = m.fids, nt = T.length / 3;
  const nrm = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const ux = N[b] - N[a], uy = N[b + 1] - N[a + 1], uz = N[b + 2] - N[a + 2];
    const vx = N[c] - N[a], vy = N[c + 1] - N[a + 1], vz = N[c + 2] - N[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    nrm.set([nx / l, ny / l, nz / l], t * 3);
  }
  const seen = new Map<number, number>(); // edge key → first triangle
  const nn = N.length / 3;
  const A: number[] = [], B: number[] = [], N1: number[] = [], N2: number[] = [];
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const i = T[t * 3 + k], j = T[t * 3 + ((k + 1) % 3)];
      const key = Math.min(i, j) * nn + Math.max(i, j);
      const o = seen.get(key);
      if (o === undefined) {
        seen.set(key, t);
        continue;
      }
      if (F[o] !== F[t]) continue;
      const dot = nrm[o * 3] * nrm[t * 3] + nrm[o * 3 + 1] * nrm[t * 3 + 1] + nrm[o * 3 + 2] * nrm[t * 3 + 2];
      if (dot > 0.99999) continue; // coplanar: never a silhouette
      A.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]);
      B.push(N[j * 3], N[j * 3 + 1], N[j * 3 + 2]);
      N1.push(nrm[o * 3], nrm[o * 3 + 1], nrm[o * 3 + 2]);
      N2.push(nrm[t * 3], nrm[t * 3 + 1], nrm[t * 3 + 2]);
    }
  return { a: new Float32Array(A), b: new Float32Array(B), n1: new Float32Array(N1), n2: new Float32Array(N2), count: A.length / 3 };
}

function silhouettes(s: GPart['sil'], dx: number, dy: number, dz: number): Float32Array {
  const out = new Float32Array(s.count * 6);
  let o = 0;
  for (let i = 0; i < s.count; i++) {
    const k = i * 3;
    const f1 = s.n1[k] * dx + s.n1[k + 1] * dy + s.n1[k + 2] * dz;
    const f2 = s.n2[k] * dx + s.n2[k + 1] * dy + s.n2[k + 2] * dz;
    if ((f1 > 0) === (f2 > 0)) continue;
    out[o++] = s.a[k]; out[o++] = s.a[k + 1]; out[o++] = s.a[k + 2];
    out[o++] = s.b[k]; out[o++] = s.b[k + 1]; out[o++] = s.b[k + 2];
  }
  return out.subarray(0, o);
}
