# Outliner

Upload a STEP file, get clean vector line art from any view. Exact hidden-line drawings from real geometry, no AI.

- `outliner_core.py`: the drawing engine (OpenCascade HLR). STEP → SVG.
- `api/index.py`: FastAPI wrapper (`/api/parts`, `/api/render`, `/api/export`, `/api/drawing`).
- `outliner_sheet.py`: sheet layout for Drawing mode (3rd angle, auto scale), ported from the production-drawing-a4 skill.
- `app/`, `components/`, `lib/`: the Next.js frontend. Design: `DESIGN.md` and Figma (links in `CLAUDE.md`).

## Setup

You need Node 20+ and Python 3.12.

```sh
npm install

# Python backend in .venv
py -3.12 -m venv .venv              # macOS/Linux: python3.12 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt     # macOS/Linux: .venv/bin/python -m pip …
```

`requirements.txt` uses `cadquery-ocp-novtk` pinned to 7.8, for two reasons:

- **No VTK.** The normal `cadquery-ocp` pulls in `vtk` (640 MB). On Windows with Smart App Control on, its VTK-linked DLL is also blocked ("An Application Control policy has blocked this file"). The `-novtk` build loads fine.
- **Version 7.8.** OCP 8.x changed APIs that `outliner_core.py` uses, such as `TDF_LabelSequence`.

## Run

```sh
npm run dev        # web on http://localhost:3000 + API on :8000 (Next proxies /api/*)
```

- `npm run web` and `npm run api` start the two halves separately.
- The API runs without auto-reload (it hangs on Windows), so restart it after you change `api/` or `outliner_core.py`.
- To try a production build locally against the local API, build it with `LOCAL_API=1 npx next build`, then run `npx next start` and `npm run api`.

Engine only:

```sh
.venv\Scripts\python outliner_core.py model.step out iso,front,top 0,0,90
```

## How it fits together

- **Upload.** `POST /api/parts` loads the STEP file once (the slow step) and caches the parts under a content hash `id`. It returns each part's readable name and its full assembly path.
- **Preview.** `POST /api/render` returns the exact HLR drawing, from the same renderer as the download, with a dark `#1C1C1C` fill so the grid doesn't show through. The lines are byte-identical to the exported SVG; the export has no fill. While a new view is being drawn, the previous drawing stays dimmed and a small "Drawing … view" indicator shows. Zoom and pan are CSS transforms and never re-render.
- **Speed.** Exact HLR costs ~2 s per new angle for a 15-part assembly (OpenCascade's `Update` + `Hide`; nothing to trim on our side), so drawings are reused instead of redrawn:
  - The preview fill is meshed once per file (`fill_mesh`).
  - SVGs are cached on the server by camera (`camera_key`; rotations that reach the same camera share one drawing, and the camera is canonical, so they are byte-identical).
  - The browser keeps the last 60 drawings (undo/redo, going back) and fetches the next angle in the same direction in the background.
  - Locally only (`npm run api` sets `OUTLINER_PREFETCH=1`), a process pool also draws the six neighbouring angles, all 24 orientations for 90° steps and the other ticked views. On Vercel there is no pool.
- **Download.** `POST /api/export` makes the exact vector drawings (HLR) on demand. You get one `.svg`, or a `.zip` for several views or for "Each part separately" (`<part>_<view>.svg`).
  - The download always contains what the preview shows.
  - Ticked parts are visible and get exported. Hide unticks a part, and Isolate unticks all the others.
  - Undo and redo cover visibility and orientation.
- **Drawing mode.**
  - `POST /api/drawing` returns the FRONT, TOP, RIGHT and ISO views as exact HLR polylines in mm, from the same cached projections as the preview, plus circles for the dimension tools and where each view goes on the sheet. FRONT is whatever the Line art orientation shows from the front.
  - `lib/sheet.ts` builds the A4/A3 sheet as SVG in the browser: frame, views, main dimensions and title block.
  - The same string is shown and downloaded as SVG; `lib/pdf.ts` turns it into a vector PDF with Geist embedded (`public/fonts`, SIL OFL).
  - Title block fields (max 8, drag to reorder) are kept in localStorage.
- **Lost cache.** If a server instance has lost the file (restart, cold start, another serverless instance), it answers `404 unknown-file`. The client then uploads the file again and retries.

## Deploying (Vercel)

- Next.js is the frontend.
- `api/index.py` runs as a Python function. In production, `next.config.ts` rewrites `/api/*` to it.
- `.python-version` pins Python 3.12, and `vercel.json` gives the function 60 s.
- **Not done yet:** files over ~4.5 MB need direct-to-Blob upload (Vercel's request body limit). Until then, large STEP files only work locally.
