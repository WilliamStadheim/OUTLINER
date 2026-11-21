# Outliner – design spec

Exact values for building the UI. The Figma v4 frames (links in CLAUDE.md) are the visual reference; this file is the measurements. Where they disagree, this file wins.

## Tokens

```css
:root {
  --bg: #1C1C1C;          /* page + canvas */
  --surface: #242426;     /* panels, cards, menus */
  --border: #3A3A3C;      /* 1px borders, dividers */
  --fill: #393939;        /* buttons/chips, used at 60% opacity */
  --text: #FFFFFF;
  --text-2: #A1A1A6;
  --text-3: #6E6E73;
  --line: #C7C7CC;        /* line art in preview */
  --accent: #E4FF3F;      /* download button + selection only */
  --x: #FF5656; --y: #58D678; --z: #528CFF;
}
```
- Font: **Geist** (Regular 400, Medium 500). No monospace anywhere.
- Sizes: brand 17/500 · card title 13/500 · body 13/400 · small 12/400 · meta 11/400 (`--text-3`).
- Radii: 4 tag · 5 menu item · 6 controls · 8 buttons · 10 cards/menus · 12 orientation card · 14 drop zone.
- Shadow only on open menus: `0 8px 24px rgba(0,0,0,.45)`.

## Layout (desktop, 1440×900 reference)

- Two columns: **left panel 328 px** (fixed) | **preview** (fills the rest). Full height, no page scroll.
- Left panel: bg `--bg`, right border 1px `--border`, padding 20 px top/bottom and 16 px left/right, gap 10 px between blocks. The download block is pinned to the bottom (a spacer fills the gap).

### Left panel, top to bottom
1. **Brand row**: logo 28 px + "Outliner" (17/500), gap 10, 10 px space below.
2. **Card** (used for File, Parts and Views): bg `--surface`, border 1px `--border`, radius 10, padding 14 px vertical / 12 px horizontal, gap 6.
   - Header row: title (13/500), with an action link on the right ("Replace" / "Select all", 12/400 `--text-2`). Header has 4 px inner side padding and 4 px space below.
3. **File card**: small file badge (28×28, radius 6, `--fill`, "STP" 8 px `--text-2`) + name (12/500) above meta (11, `--text-3`, e.g. "0.7 MB · 1 part").
   - Empty: "No file yet — drop a STEP file anywhere" (12, `--text-3`).
4. **Parts card** (assemblies only):
   - Segmented toggle using chips: "Whole model" / "Each part separately".
   - Then checkbox rows, then "+ N more parts" (12, `--text-3`).
   - The selected part's row: bg `--accent` at 14 % opacity.
5. **Views card**: checkbox rows ISO, Front, Back, Left, Right, Top, Bottom. Meta on the right (`−Y`, `+Y`, `−X`, `+X`, `+Z`, `−Z`; ISO has none).
   - In the empty state the rows are at 40 % opacity and disabled.
6. **Download block**: summary line (11, `--text-3`, e.g. "3 parts × 2 views = 6 files (.zip)"), gap 8, then the split button.

### Components
- **Checkbox row**: height 32, padding 7/8, gap 10, radius 6. Box 14×14, radius 3:
  - Unchecked: border 1.2px `--text-3`, label `--text-2`.
  - Checked: fill and border `--text`, check mark in `--bg`, label `--text`.
  - Meta text on the right (11, `--text-3`).
- **Chip**: height 28, padding 0 10, radius 6, 12/500.
  - Default: `--fill` @60 %, text `--text-2`.
  - Selected: bg `--text`, text `--bg`.
- **Split download button**: full width, height 44, radius 8, bg `--accent`, text `--bg`.
  - Left part: download icon 16 + "Download 3 drawings" (14/500), padding-left 16. The left part downloads.
  - 1px divider (`--bg` @25 %).
  - Right part: "SVG" + chevron, padding 0 12. It opens the format menu: SVG, PDF, DXF, PNG, with meta "vector", "vector", "CAD", "2× raster".
  - Disabled: 35 % opacity.
- **Dropdown pill** ("ISO view ▾"): padding 7/10/7/12, radius 8, bg `--surface`, border 1px `--border`, 13/500, chevron 12 `--text-2`.
- **Menu**: bg `--surface`, border 1px `--border`, radius 10, padding 6, gap 2, shadow.
  - Item: 180×30, padding 0 10, radius 5, 13/400, shortcut right-aligned (11, `--text-3`).
  - Hover: `--fill`.
  - Divider: 1px `--border`.
- **Context menu (right-click on a part)**: header with the part name (11, `--text-3`), then:
  - Isolate (I)
  - Hide (H)
  - Select in list
  - Download this part
  - divider
  - Show all (⇧H)

### Preview canvas
- Background `--bg`.
  - Empty: **dot grid**.
  - Model loaded: **isometric grid** with a top fade.
- **Empty state**: drop zone 560×360, centred, radius 14, bg `--surface` @60 %, dashed border 1.2px `--text-3` (dash 6/6). Inside, centred with gap 10:
  - cube icon 56
  - "Drop a STEP file here" (18/500)
  - ".step or .stp — single part or assembly" (12, `--text-3`)
  - "Browse files" button (`--fill`, radius 8, padding 8/14, 13/500)

  The whole window accepts drops, not only the box.
- **Loaded**:
  - Line art centred, stroke `--line` 1px, `vector-effect: non-scaling-stroke`.
  - View dropdown at top-left (24 px inset).
  - Orientation card at top-right (24 px inset).
- **Selection**: the clicked part's `<g>` gets stroke `--accent` 1.5px and fill `--accent` @10 %. It also gets a name tag: bg `--accent`, text `--bg` 11/500, radius 4, padding 3/6.

### Orientation card
- Width 248, padding 14, gap 12, radius 12, bg `--surface`, border 1px `--border`.
- Header: "Orientation" (13/500) + Reset (↺ icon 13 + "Reset", 12 `--text-2`).
- Gimbal SVG 220×190 (code below). It re-renders from the current rotation.
- Three rows, in the order **X, Y, Z**. Each row has:
  - dot 8px in the axis colour
  - "X axis" (12/500)
  - current angle (12; `--text-3` when 0°, `--text` otherwise, e.g. "+90°")
  - spacer
  - two buttons 30×28, radius 6, `--fill` @60 %, with ↺ and ↻ icons (14 px) in the axis colour
- Step row: "Step" (11, `--text-3`) + chips 15° 30° 45° 90° (one selected).
- Rotation is about the model's X, Y, Z axes, applied X → Y → Z. Pass it straight to `render(..., rot=(x, y, z))`.

## Graphics (generate in code, don't export from Figma)

### Logo (28×28, use `currentColor` = `--text`)
```svg
<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M 11.75 3.10 Q 14.00 1.80 16.25 3.10 L 22.31 6.60 Q 24.57 7.90 24.57 10.50 L 24.57 17.50 Q 24.57 20.10 22.31 21.40 L 16.25 24.90 Q 14.00 26.20 11.75 24.90 L 5.69 21.40 Q 3.43 20.10 3.43 17.50 L 3.43 10.50 Q 3.43 7.90 5.69 6.60 Z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
  <path d="M 14.00 14.00 L 23.09 8.75 M 14.00 14.00 L 4.91 8.75 M 14.00 14.00 L 14.00 24.49" stroke="currentColor" stroke-opacity="0.75" stroke-width="1.1" stroke-linecap="round"/>
</svg>
```

### Dot grid (empty state)
1.5×1.5 px squares every 24 px, colour `--text-3` at 35 %. A CSS `radial-gradient` background works:
`background-image: radial-gradient(rgba(110,110,115,.35) 0.9px, transparent 1px); background-size: 24px 24px;`

### Isometric grid (model loaded)
- Two families of lines at ±30° from horizontal, 34 px apart (measured perpendicular), 1px, `rgb(153,153,163)` at 13 %.
- On top, a fade: `linear-gradient(to bottom, var(--bg) 0%, transparent 45%)`.
- Draw it as an SVG `<pattern>` or a canvas behind the line art.

### Gimbal (orientation card)
- Iso projection. Model X goes down-right, Y goes up-right, Z goes up. The viewer looks along (1, −1, 1).
- Three axis-coloured rings around a small cube.
- The **back half of each ring** is dashed and faint. The front half is solid.
- Draw order: back halves → cube → front halves.
- The cube is filled `--surface` with faint white tints, has thin inner edges, and a 1.7px white silhouette.
- Rotate the cube and rings by the current rotation matrix `R` before projecting, so the gimbal follows the model.

```ts
const COL = { x: '#FF5656', y: '#58D678', z: '#528CFF' };
type V3 = [number, number, number];

export function gimbalSVG(R: number[][] = [[1,0,0],[0,1,0],[0,0,1]], W = 220, H = 190, s = 17, ringPx = 54) {
  const cx = W / 2, cy = H / 2, Rr = ringPx / s;
  const rot = (q: V3): V3 => [0,1,2].map(i => R[i][0]*q[0] + R[i][1]*q[1] + R[i][2]*q[2]) as V3;
  const P = (q: V3) => { const [x,y,z] = rot(q); return [cx + s*0.866*(x+y), cy + s*(0.5*(x-y) - z)]; };
  const depth = (q: V3) => { const [x,y,z] = rot(q); return x - y + z; };   // > 0 = towards viewer
  const f = (p: number[]) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;

  // rings: plane perpendicular to each axis
  const planes: Record<'x'|'y'|'z', [V3, V3]> = { x: [[0,1,0],[0,0,1]], y: [[1,0,0],[0,0,1]], z: [[1,0,0],[0,1,0]] };
  let back = '', front = '';
  for (const k of ['x','y','z'] as const) {
    const [u, w] = planes[k]; let solid = '', dash = ''; const N = 200;
    const pt = (t: number): V3 => { const a = t*2*Math.PI; return [0,1,2].map(j => Rr*(Math.cos(a)*u[j] + Math.sin(a)*w[j])) as V3; };
    for (let i = 0; i < N; i++) {
      const a = pt(i/N), b = pt((i+1)/N), m = a.map((v,j) => (v + b[j]) / 2) as V3;
      const seg = `M${f(P(a))} L${f(P(b))} `;
      if (depth(m) < 0) dash += seg; else solid += seg;
    }
    back  += `<path d="${dash}" stroke="${COL[k]}" stroke-opacity="0.45" stroke-width="1.6" stroke-dasharray="2 3" fill="none"/>`;
    front += `<path d="${solid}" stroke="${COL[k]}" stroke-width="1.8" stroke-linecap="round" fill="none"/>`;
  }

  // cube [-1,1]^3: draw the 3 faces whose normal points to the viewer
  const faces: { n: V3; pts: V3[]; tint: number }[] = [
    { n: [0,0,1],  pts: [[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],      tint: .08 },
    { n: [0,0,-1], pts: [[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]],  tint: .08 },
    { n: [0,-1,0], pts: [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]],  tint: .05 },
    { n: [0,1,0],  pts: [[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]],      tint: .05 },
    { n: [1,0,0],  pts: [[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]],      tint: .03 },
    { n: [-1,0,0], pts: [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]],  tint: .03 },
  ];
  let cube = '';
  for (const fc of faces) if (depth(fc.n) > 1e-6) {
    const pts = fc.pts.map(q => f(P(q))).join(' ');
    cube += `<polygon points="${pts}" fill="#242426"/><polygon points="${pts}" fill="#FFFFFF" fill-opacity="${fc.tint}" stroke="#C7C7CC" stroke-opacity="0.7" stroke-width="1" stroke-linejoin="round"/>`;
  }
  // silhouette: convex hull of the 8 projected corners, 1.7px white
  const corners = [-1,1].flatMap(x => [-1,1].flatMap(y => [-1,1].map(z => P([x,y,z] as V3))));
  cube += `<polygon points="${hull(corners).map(f).join(' ')}" fill="none" stroke="#FFFFFF" stroke-width="1.7" stroke-linejoin="round"/>`;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${back}${cube}${front}</svg>`;
}

function hull(p: number[][]) {   // monotone chain
  const pts = [...p].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0]);
  const lo: number[][] = [], up: number[][] = [];
  for (const q of pts) { while (lo.length > 1 && cross(lo[lo.length-2], lo[lo.length-1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of pts.reverse()) { while (up.length > 1 && cross(up[up.length-2], up[up.length-1], q) <= 0) up.pop(); up.push(q); }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}
```
Build `R` with the same formula as `rotation_matrix()` in `outliner_core.py` (Rz·Ry·Rx, degrees), so the gimbal and the drawing always agree.

## Behaviour notes
- Selecting a part in the drawing selects it in the list, and the other way round.
- The rotation applies to every exported view. The preview dropdown only changes which view is shown.
- Keep every interactive target at least 28 px tall. Show focus rings on keyboard focus.
