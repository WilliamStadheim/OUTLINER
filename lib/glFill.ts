/**
 * The preview's solid fill on the GPU (WebGL2). The fill mesh (~65k triangles for a big assembly) is
 * uploaded once per file; each new angle only changes six camera numbers, so redrawing costs well
 * under a millisecond of CPU. MSAA keeps shared triangle edges watertight, so no stroke is needed to
 * hide seams. The lines on top stay the exact SVG.
 */
import type { FillMesh } from './lightFill';

type Frame = { x0: number; y1: number; s: number; pad: number; d: number[]; x: number[] };
type GPart = { part: number; vao: WebGLVertexArrayObject; count: number; centre: [number, number, number] };

const VS = `#version 300 es
in vec3 p;
uniform vec3 uX, uY;      // screen right / up in model space
uniform vec4 uMap;        // x0, y1, s, pad   (svg x = (p·X − x0)·s + pad, svg y = (y1 − p·Y)·s + pad)
uniform vec2 uVB;         // viewBox width, height
void main() {
  vec2 q = vec2((dot(p, uX) - uMap.x) * uMap.z + uMap.w, (uMap.y - dot(p, uY)) * uMap.z + uMap.w);
  gl_Position = vec4(q.x / uVB.x * 2.0 - 1.0, 1.0 - q.y / uVB.y * 2.0, 0.0, 1.0);
}`;
const FS = `#version 300 es
precision mediump float;
uniform vec4 uColour;
out vec4 o;
void main() { o = uColour; }`;

export class GLFill {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null>;
  private parts: GPart[] = [];
  private buffers: WebGLBuffer[] = [];
  private mesh: FillMesh | null = null;

  static create(canvas: HTMLCanvasElement): GLFill | null {
    const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: false });
    if (!gl) return null;
    try {
      return new GLFill(gl);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'p');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    this.prog = prog;
    this.u = Object.fromEntries(['uX', 'uY', 'uMap', 'uVB', 'uColour'].map((n) => [n, gl.getUniformLocation(prog, n)]));
  }

  get canvas() {
    return this.gl.canvas as HTMLCanvasElement;
  }

  /** Upload a file's mesh once (no-op for the same mesh). */
  setMesh(mesh: FillMesh) {
    if (mesh === this.mesh) return;
    const gl = this.gl;
    for (const b of this.buffers) gl.deleteBuffer(b);
    for (const p of this.parts) gl.deleteVertexArray(p.vao);
    this.buffers = [];
    this.parts = [];
    for (const m of mesh) {
      if (!m.tris.length) continue;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer()!, ib = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.bufferData(gl.ARRAY_BUFFER, m.nodes, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.tris, gl.STATIC_DRAW);
      this.buffers.push(vb, ib);
      this.parts.push({ part: m.part, vao, count: m.tris.length, centre: m.centre });
    }
    gl.bindVertexArray(null);
    this.mesh = mesh;
  }

  /** Draw the drawn parts far → near (as the server did) at the canvas' backing size. */
  draw(fr: Frame, vb: [number, number], drawn: Set<number>, colour: [number, number, number], tint: [number, number, number], selected: number | null) {
    const gl = this.gl, c = gl.canvas as HTMLCanvasElement;
    const [dx, dy, dz] = fr.d, [xx, xy, xz] = fr.x;
    const y = [dy * xz - dz * xy, dz * xx - dx * xz, dx * xy - dy * xx];
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform3f(this.u.uX, xx, xy, xz);
    gl.uniform3f(this.u.uY, y[0], y[1], y[2]);
    gl.uniform4f(this.u.uMap, fr.x0, fr.y1, fr.s, fr.pad);
    gl.uniform2f(this.u.uVB, vb[0], vb[1]);
    const depth = (p: GPart) => p.centre[0] * dx + p.centre[1] * dy + p.centre[2] * dz;
    for (const p of this.parts.filter((q) => drawn.has(q.part)).sort((a, b) => depth(a) - depth(b))) {
      const col = p.part === selected ? tint : colour;
      gl.uniform4f(this.u.uColour, col[0] / 255, col[1] / 255, col[2] / 255, 1);
      gl.bindVertexArray(p.vao);
      gl.drawElements(gl.TRIANGLES, p.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }
}
