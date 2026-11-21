# Outliner

Web app: upload a STEP file, get clean vector line art (SVG) of it from chosen views. All drawing is done by script from the real geometry (OpenCascade hidden-line removal). No AI in the pipeline. Same input gives the same drawing every time.

## Design (source of truth)

Figma file "Pictorial", page "Lineart APP". Use the Figma MCP to read the frames. Build from **v4**:

- Empty state: https://www.figma.com/design/QtWdEeRQLeaIYMibGtKBDD/Pictorial?node-id=277-599
- File loaded: https://www.figma.com/design/QtWdEeRQLeaIYMibGtKBDD/Pictorial?node-id=277-638
- Assembly, part selected and right-click menu: https://www.figma.com/design/QtWdEeRQLeaIYMibGtKBDD/Pictorial?node-id=277-924

Components:
- checkbox row 268-280
- chip 268-285
- download split button 268-286
- dropdown pill 268-296
- menu item 268-306
- logo 279-763

Ignore v1 to v3 and the "Orientation card – proposals" frames. They are earlier iterations.

### Look

- Dark UI.
  - Page and canvas: `#1C1C1C`
  - Panels and cards: `#242426`
  - Borders and dividers: `#3A3A3C`
  - Buttons and chips: `#393939` at 60 %
- Text:
  - Primary text: `#FFFFFF`
  - Secondary text: `#A1A1A6`
  - Muted text: `#6E6E73`
- Accent `#E4FF3F`. Use it only for the download button and the selected part.
- Axis colours, used consistently everywhere:
  - X `#FF5656`
  - Y `#58D678`
  - Z `#528CFF`
- Line art in the preview: `#C7C7CC`, thin (1 px).
- Font: **Geist** only. No monospace anywhere.
- Canvas background:
  - Empty state: subtle dot grid.
  - With a model loaded: faint isometric grid that fades out towards the top.
- Small radii (6–12 px), no heavy shadows except on open menus.

## Layout and behaviour

**Left panel (328 px)**, top to bottom:
1. Logo and app name "Outliner".
2. Card **File**: file name, size and part count, plus "Replace".
3. Card **Parts**: only shown for assemblies. Contains:
   - Toggle "Whole model" / "Each part separately".
   - List of parts with checkboxes and "Select all".
4. Card **Views**: ISO, Front, Back, Left, Right, Top, Bottom (checkboxes), plus "Select all".
5. Bottom: a summary line (e.g. "3 parts × 2 views = 6 files (.zip)") and the accent **split button**. The left part downloads. The chevron on the right opens a format menu: SVG, PDF, DXF, PNG.

**Right: preview canvas.**
- Drag and drop a STEP file anywhere. The empty state shows a drop zone and a "Browse files" button.
- Top left: **"ISO view" dropdown**. It switches which view the preview shows (ISO, Front, Back, Left, Right, Top, Bottom).
- Top right: **Orientation card**:
  - Header "Orientation" with "↺ Reset".
  - Gimbal graphic: a transparent cube with three coloured rotation rings. A ring segment is dashed only where the cube hides it. Neutral grey axes go through the cube centre, the same length out of every face, with no arrowheads. The graphic should update when the model is rotated.
  - Rows **X axis / Y axis / Z axis**: coloured dot, current angle (e.g. "0°", "+90°"), rotate −/+ buttons.
  - **Step**: 15° / 30° / 45° / 90°.
  - The rotation applies to the model, so every exported view uses the chosen orientation.
- Click a part in the drawing to select it. It turns accent-coloured, gets a name tag and is highlighted in the parts list. Right-click opens a menu: Isolate (I), Hide (H), Select in list, Download this part, Show all (⇧H).

## Scope

**MVP (build first):**
- Upload one STEP file.
- ISO preview.
- Tick views.
- Download SVG (a zip if more than one).
- Orientation card with step rotation.
- Dark design as above.

**Later:**
- Assemblies: parts list, isolate, export each part separately.
- Click-select and right-click menu.
- PDF, DXF and PNG export.
- A faster client-side 3D preview while rotating.

## Architecture

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel from GitHub.
- **Backend:** Python (FastAPI) as a Vercel Python Function, using `cadquery-ocp` + `numpy`. Do not include `vtk`.
- **Drawing engine:** `outliner_core.py` in this repo (tested). `load(path)` → parts, `render(parts, view, rot=(x,y,z), only=[...], algo='auto')` → SVG string with one `<g id="part-i" data-name="…">` per part, `auto_orient(parts)` for the optional Auto button. Model is shown Z-up as modelled. Wrap it, don't rewrite it. Cache `parts` per uploaded file (loading is the slow step: 0.6 s for a part, ~3.5 s for a 15-part assembly; each view then takes 0.2–2 s).
- **Python deps:** `cadquery-ocp`, `numpy`, `fastapi`. Do **not** install `vtk` (cadquery-ocp may pull it in; it is 640 MB and unused).
- **Endpoints (suggested):**
  - `POST /api/parts`: returns the part list.
  - `POST /api/render` (file ref, view, rotation XYZ, parts): returns SVG. The preview uses the same endpoint as the export, so what you see is what you get.
  - `POST /api/export`: returns a zip.
- **Limits to plan for:**
  - Vercel functions accept about 4.5 MB request bodies. Upload STEP files to Vercel Blob from the client and pass the URL to the function.
  - Python bundles can be up to 500 MB.
  - If OCP is too heavy or cold starts are too slow, move the Python part to a Docker service (Railway, Render or Fly.io) and keep the frontend on Vercel.

## Test files

Ask William for STEP files. Good cases:
- A single bent sheet part: `MountingRack_bent.step`.
- A screw with modelled threads.
- The full OCU assembly: `OCU_Prototype03_Assembly.step`, about 4 MB, 15 parts.

## Working style

- Keep it simple. Build the MVP end to end before adding features.
- UI text in English.
