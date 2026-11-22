'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiHealth, exportViews, fetchDrawing, fetchFillMesh, prefetchViews, renderGuess, renderView, uploadFile, type DrawingParams, type LoadedFile } from '@/lib/api';
import type { FillMesh } from '@/lib/lightFill';
import { saveBlob, sheetToPdf, sheetsToPdf } from '@/lib/pdf';
import { buildSheet, mainDims, titleCells, type Dim, type DrawingData, type TitleField } from '@/lib/sheet';
import { loadFields, saveFields, titleFromFile } from '@/lib/titleblock';
import { VIEWS, cameraKey, formatSize, wrapAngle, type Rot, type View } from '@/lib/views';
import { Check, Chevron, DownloadIcon, Logo } from './icons';
import DrawingView from './DrawingView';
import Preview, { type PartAction } from './Preview';
import TitleBlockCard from './TitleBlockCard';
import ThemeToggle from './ThemeToggle';
import { Card, CheckboxRow, Chip, LinkButton, Menu, Segmented } from './ui';

const FORMATS = [
  { key: 'svg', label: 'SVG', meta: 'vector' },
  { key: 'pdf', label: 'PDF', meta: 'vector', disabled: true, title: 'Coming soon' },
  { key: 'dxf', label: 'DXF', meta: 'CAD', disabled: true, title: 'Coming soon' },
  { key: 'png', label: 'PNG', meta: '2× raster', disabled: true, title: 'Coming soon' },
];

const isStep = (f: File) => /\.(step|stp)$/i.test(f.name);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sorted = (s: Iterable<number>) => [...s].sort((a, b) => a - b);
const CLIENT_CACHE = 300; // drawings kept in the browser (lines only, ~40–100 kB each): visited + precached angles
const PRECACHE_45 = 48; // background 45° angles per file and view, nearest first (each costs ~4 s of server CPU)

/** What undo/redo restores: which parts are shown, the isolation, and the orientation. */
type Snapshot = { shown: number[]; isolation: Isolation | null; rot: Rot };
/** An isolated part, and the parts that were shown before, so Unisolate can bring them back. */
type Isolation = { part: number; before: number[] };

/** One row in the Parts card: the box shows/hides the part, the name selects it. */
function PartRow({
  index,
  name,
  title,
  checked,
  selected,
  onToggle,
  onSelect,
}: {
  index: number;
  name: string;
  title: string;
  checked: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  return (
    <div
      id={`part-row-${index}`}
      className={`flex h-8 w-full shrink-0 items-center gap-2.5 rounded-md px-2 ${selected ? 'bg-accent/14' : 'hover:bg-fill/40'}`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`${checked ? 'Hide' : 'Show'} ${name}`}
        onClick={onToggle}
        className={`relative size-3.5 shrink-0 rounded-[3px] border-[1.2px] ${checked ? 'border-fg bg-fg text-bg' : 'border-fg-3 hover:border-fg-2'}`}
      >
        {checked && <Check className="absolute -top-[1.2px] -left-[1.2px]" />}
      </button>
      <button
        type="button"
        onClick={onSelect}
        title={title}
        className={`h-full min-w-0 flex-1 truncate text-left text-[13px] ${checked ? 'text-fg' : 'text-fg-3'}`}
      >
        {name}
      </button>
      {!checked && <span className="shrink-0 text-[11px] text-fg-3">hidden</span>}
    </div>
  );
}

/** Two-state toggle: Whole assembly / Each part separately. */
function ModeToggle({ mode, onChange }: { mode: 'whole' | 'each'; onChange: (m: 'whole' | 'each') => void }) {
  return (
    <Segmented
      label="Download as"
      value={mode}
      onChange={onChange}
      options={[
        { key: 'whole', label: 'Whole assembly' },
        { key: 'each', label: 'Each part separately' },
      ]}
      className="w-full gap-0.5 rounded-md bg-fill/60 p-0.5 [--seg-pad:2px] [--seg-radius:5px]"
      segmentClass="flex h-6 flex-auto items-center justify-center rounded-[5px] px-2 text-[12px] font-medium whitespace-nowrap"
    />
  );
}

export default function Outliner() {
  const [file, setFile] = useState<File | null>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [loadingName, setLoadingName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [views, setViews] = useState<Set<View>>(() => new Set(['iso']));
  const [preview, setPreview] = useState<View>('iso');
  const [rot, setRot] = useState<Rot>([0, 0, 0]);
  const [step, setStep] = useState(90);

  // Left panel can be hidden to give the preview / sheet the whole window (remembered)
  const [panelOpen, setPanelOpenState] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem('outliner-panel') === 'hidden') setPanelOpenState(false);
    } catch {}
  }, []);
  const setPanelOpen = (open: boolean) => {
    setPanelOpenState(open);
    try {
      localStorage.setItem('outliner-panel', open ? 'shown' : 'hidden');
    } catch {}
  };

  // Drawing mode (A4/A3 production drawing). File, parts and orientation are shared with Line art.
  const [appMode, setAppMode] = useState<'lineart' | 'drawing'>('lineart');
  const [drawViews, setDrawViews] = useState<Set<'top' | 'right' | 'iso'>>(() => new Set(['top', 'right', 'iso']));
  const [sheetSize, setSheetSize] = useState<'A4' | 'A3'>('A4');
  const [orient, setOrient] = useState<'landscape' | 'portrait'>('landscape');
  const [scaleOpt, setScaleOpt] = useState<string>('auto'); // 'auto' or a standard scale that fits
  const [scaleMenu, setScaleMenu] = useState(false);
  const [drawing, setDrawing] = useState<DrawingData | null>(null);
  const [drawingLoading, setDrawingLoading] = useState(false);
  const [drawingError, setDrawingError] = useState<string | null>(null);
  const [fields, setFieldsState] = useState<TitleField[]>([]);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  // pdf: one PDF per sheet (zipped for several parts); pdf1: all parts as the pages of one PDF
  const [drawFormat, setDrawFormat] = useState<'svg' | 'pdf' | 'pdf1'>('svg');
  const [drawPart, setDrawPart] = useState<number | null>(null); // assemblies: one component, or null = whole
  const drawingCache = useRef(new Map<string, DrawingData>());
  useEffect(() => setFieldsState(loadFields()), []);
  const setFields = (f: TitleField[]) => {
    setFieldsState(f);
    saveFields(f);
  };
  // Assemblies: each sheet (the whole assembly, or one component) can have its own title block. `fields`
  // is the shared layout every sheet starts from; "Apply to all sheets" makes the current one shared
  // (each sheet keeps its own title).
  const [sheetFields, setSheetFields] = useState<Record<string, TitleField[]>>({});
  const fieldsFor = (key: string) => sheetFields[key] ?? fields;

  // Assemblies. A ticked part is shown in the preview AND downloaded — Hide just unticks it.
  const [shown, setShown] = useState<Set<number>>(() => new Set());
  const [isolation, setIsolation] = useState<Isolation | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<'whole' | 'each'>('whole');

  const [svg, setSvg] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [formatMenu, setFormatMenu] = useState(false);
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const loadToken = useRef(0);

  // ---------- undo / redo (parts shown, isolation, orientation)

  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const [, setHistoryTick] = useState(0);
  const snapshot = (): Snapshot => ({ shown: sorted(shown), isolation, rot });
  const restore = (s: Snapshot) => {
    setShown(new Set(s.shown));
    setIsolation(s.isolation);
    setRot(s.rot);
  };
  /** Record the current state before a change, so it can be undone. */
  const record = () => {
    undoStack.current.push(snapshot());
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    setHistoryTick((t) => t + 1);
  };
  const undo = () => {
    const s = undoStack.current.pop();
    if (!s) return;
    redoStack.current.push(snapshot());
    restore(s);
    setHistoryTick((t) => t + 1);
  };
  const redo = () => {
    const s = redoStack.current.pop();
    if (!s) return;
    undoStack.current.push(snapshot());
    restore(s);
    setHistoryTick((t) => t + 1);
  };

  // ---------- file loading

  const openFile = useCallback(async (f: File) => {
    if (!isStep(f)) {
      setError('That is not a STEP file. Use a .step or .stp file.');
      return;
    }
    const token = ++loadToken.current;
    setError(null);
    setLoadingName(f.name);
    try {
      const res = await uploadFile(f);
      if (token !== loadToken.current) return;
      setFile(f);
      setLoaded(res);
      setSvg(null);
      svgCache.current.clear();
      setDrawing(null);
      setDrawPart(null);
      setSheetFields({});
      drawingCache.current.clear();
      lastTurn.current = null;
      setShown(new Set(res.parts.map((p) => p.index)));
      setIsolation(null);
      setSelected(null);
      setMode('whole');
      setRot([0, 0, 0]);
      undoStack.current = [];
      redoStack.current = [];
      setHistoryTick((t) => t + 1);
    } catch (e) {
      if (token === loadToken.current) setError(e instanceof Error ? e.message : 'Could not read the file');
    } finally {
      if (token === loadToken.current) setLoadingName(null);
    }
  }, []);

  const browse = () => inputRef.current?.click();

  // Drop a file anywhere in the window. A counter keeps the state steady over child elements.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) openFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [openFile]);

  // ---------- parts

  const partCount = loaded?.parts.length ?? 0;
  const isAssembly = partCount > 1;
  const partName = (i: number) => loaded?.parts[i]?.name ?? `Part ${i + 1}`;
  const drawn = useMemo(() => sorted(shown), [shown]);
  const nothingToDraw = !!loaded && drawn.length === 0;
  // null = whole model (lets the server reuse its full-model cache)
  const partsParam = useMemo(() => (drawn.length === partCount ? null : drawn), [drawn, partCount]);
  const partsKey = partsParam?.join(',') ?? 'all';

  // ---------- preview: the exact HLR drawing (same renderer as the download, plus the dark fill)
  //
  // Drawings are cached in the browser by camera (+ parts), and in-flight requests are shared, so
  // undo/redo, going back, and an angle fetched ahead of time show at once. After each view the next
  // angle in the same direction is fetched in the background (or, when the API runs locally with a
  // prefetch pool, the pool is asked to draw the neighbouring angles).

  const svgCache = useRef(new Map<string, string>());
  const guessing = useRef(new Set<string>()); // in-flight requests that are only guesses
  const onScreen = useRef<string | null>(null); // the drawing key the preview wants right now
  // The preview's solid fill: one mesh per file, projected in the browser for every angle
  const [fillMesh, setFillMesh] = useState<{ id: string; mesh: FillMesh } | null>(null);
  useEffect(() => {
    if (!loaded || !file || fillMesh?.id === loaded.id) return;
    let live = true;
    const ctrl = new AbortController();
    fetchFillMesh(file, loaded.id, ctrl.signal)
      .then((mesh) => live && setFillMesh({ id: loaded.id, mesh }))
      .catch(() => {}); // the preview works without it (the grid shows through)
    return () => {
      live = false;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded?.id, file]);
  const pending = useRef(new Map<string, Promise<string>>());
  const lastTurn = useRef<{ axis: number; delta: number } | null>(null);
  const [poolPrefetch, setPoolPrefetch] = useState(false);
  useEffect(() => {
    apiHealth().then((h) => setPoolPrefetch(!!h.prefetch));
  }, []);

  const drawingKey = (view: View, r: Rot) => `${loaded?.id}|${cameraKey(view, r)}|${partsKey}`;
  const fetchSvg = (view: View, r: Rot, guess = false): Promise<string> => {
    const key = drawingKey(view, r);
    const hit = svgCache.current.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const inFlight = pending.current.get(key);
    if (inFlight) {
      // waiting on a guess for exactly this angle: if the server dropped it, ask for real
      return guess || !guessing.current.has(key) ? inFlight : inFlight.catch(() => fetchSvg(view, r));
    }
    if (guess) guessing.current.add(key);
    const real = () =>
      renderView(file!, loaded!.id, view, r, partsParam).catch((e) => {
        // dropped because another angle was asked for; if this is still the one on screen, ask again
        if (e instanceof ApiError && e.status === 409 && onScreen.current === key) return renderView(file!, loaded!.id, view, r, partsParam);
        throw e;
      });
    const p = (guess ? renderGuess(loaded!.id, view, r, partsParam) : real())
      .then((s) => {
        const c = svgCache.current;
        c.delete(key);
        c.set(key, s);
        while (c.size > CLIENT_CACHE) c.delete(c.keys().next().value!);
        return s;
      })
      .finally(() => {
        pending.current.delete(key);
        guessing.current.delete(key);
      });
    pending.current.set(key, p);
    return p;
  };

  /**
   * Background precache (no local pool): one guessed angle at a time, each dropped by the server the
   * moment you click yourself, then restarted from where you are. Order: the next angle in the
   * direction you are turning, every 90° orientation (nearest first), then 45° steps around you.
   */
  const precacheGen = useRef(0);
  const precache = (view: View, from: Rot) => {
    const gen = ++precacheGen.current;
    if (!loaded || !file) return;
    const id = loaded.id;
    const seen = new Set<string>([cameraKey(view, from)]);
    const queue: Rot[] = [];
    const add = (r: Rot) => {
      const k = cameraKey(view, r);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(r);
      }
    };
    if (lastTurn.current) {
      const { axis, delta } = lastTurn.current;
      add(from.map((a, i) => (i === axis ? wrapAngle(a + delta) : a)) as Rot);
    }
    const bfs = (stepDeg: number, limit: number) => {
      let frontier: Rot[] = [from];
      let n = 0;
      while (frontier.length && n < limit) {
        const next: Rot[] = [];
        for (const r of frontier)
          for (let axis = 0; axis < 3; axis++)
            for (const sgn of [1, -1]) {
              const q = r.map((a, i) => (i === axis ? wrapAngle(a + sgn * stepDeg) : a)) as Rot;
              const before = queue.length;
              add(q);
              if (queue.length > before) {
                next.push(q);
                if (++n >= limit) return;
              }
            }
        frontier = next;
      }
    };
    bfs(90, 64); // all 24 orientations
    bfs(45, PRECACHE_45);
    const run = async () => {
      for (const r of queue) {
        if (gen !== precacheGen.current) return;
        while (typeof document !== 'undefined' && document.hidden) {
          await new Promise((ok) => setTimeout(ok, 1000));
          if (gen !== precacheGen.current) return;
        }
        if (svgCache.current.has(drawingKey(view, r))) continue;
        try {
          await fetchSvg(view, r, true);
        } catch (e) {
          if (gen !== precacheGen.current) return;
          if (e instanceof ApiError && e.status === 404) {
            // this server instance doesn't have the file: give it the file once, then go on
            try {
              await uploadFile(file);
            } catch {
              return;
            }
            continue;
          }
          return; // dropped (409): you clicked; the queue restarts from your new view
        }
      }
    };
    run();
  };

  useEffect(() => {
    if (!loaded || !file) return;
    if (partsParam && partsParam.length === 0) {
      setSvg(null);
      setRendering(false);
      return;
    }
    let live = true;
    const ahead = () => {
      if (!live) return;
      if (poolPrefetch) {
        prefetchViews(loaded.id, preview, rot, step, partsParam, VIEWS.map((v) => v.id).filter((v) => v !== preview && views.has(v)));
      } else {
        precache(preview, rot);
      }
    };
    const show = (s: string) => {
      if (!live) return;
      setSvg(s);
      setError(null);
      setRendering(false);
      ahead();
    };
    onScreen.current = drawingKey(preview, rot);
    const hit = svgCache.current.get(drawingKey(preview, rot));
    if (hit !== undefined) {
      show(hit);
      return () => {
        live = false;
      };
    }
    setRendering(true);
    const t = setTimeout(() => {
      fetchSvg(preview, rot)
        .then(show)
        .catch((e) => {
          if (!live) return;
          setRendering(false);
          setError(e instanceof Error ? e.message : 'Could not draw this view');
        });
    }, pending.current.has(drawingKey(preview, rot)) ? 0 : 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // partsKey stands in for partsParam
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, file, preview, rot, partsKey, poolPrefetch]);

  // ---------- drawing: views + placement from the API, sheet built here (preview = download)

  useEffect(() => {
    if (appMode !== 'drawing' || !loaded || !file || (nothingToDraw && drawPart === null)) return;
    const params: DrawingParams = {
      rot,
      parts: drawPart !== null ? [drawPart] : partsParam,
      views: ['front', ...(['top', 'right', 'iso'] as const).filter((v) => drawViews.has(v))],
      sheet: sheetSize,
      orient,
      scale: scaleOpt,
    };
    const key = loaded.id + JSON.stringify(params);
    const hit = drawingCache.current.get(key);
    if (hit) {
      setDrawing(hit);
      setDrawingLoading(false);
      return;
    }
    let live = true;
    const ctrl = new AbortController();
    setDrawingLoading(true);
    const t = setTimeout(() => {
      fetchDrawing(file, loaded.id, params, ctrl.signal)
        .then((d) => {
          (d as DrawingData & { geomKey?: string }).geomKey = `${loaded.id}|${rot.join(',')}|${drawPart ?? partsKey}`;
          drawingCache.current.set(key, d);
          if (!live) return;
          setDrawing(d);
          setDrawingError(null);
          setDrawingLoading(false);
        })
        .catch((e) => {
          if (!live || ctrl.signal.aborted) return;
          setDrawingLoading(false);
          setDrawingError(e instanceof Error ? e.message : 'Could not make the drawing');
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
      ctrl.abort();
    };
    // partsKey stands in for partsParam
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appMode, loaded, file, rot, partsKey, drawPart, drawViews, sheetSize, orient, scaleOpt]);

  // A fixed scale that no longer fits the sheet falls back to Auto
  useEffect(() => {
    if (drawing && scaleOpt !== 'auto' && !drawing.options[scaleOpt]) setScaleOpt('auto');
  }, [drawing, scaleOpt]);

  const isAsm = !!loaded && loaded.parts.length > 1;
  const sheetKey = isAsm && drawPart !== null ? String(drawPart) : 'all';
  const sheetFieldsNow = fieldsFor(sheetKey);
  const setSheetFieldsNow = (f: TitleField[]) => {
    if (!isAsm) return setFields(f); // one sheet: it is the layout
    setSheetFields((m) => ({ ...m, [sheetKey]: f }));
  };
  const applyToAllSheets = () => {
    const shared = sheetFieldsNow.map((f) => (f.id === 'title' ? { ...f, value: '' } : f));
    setFields(shared);
    // every sheet takes the shared layout and values, but keeps its own title
    setSheetFields((m) => {
      const next: Record<string, TitleField[]> = {};
      for (const [k, fs] of Object.entries(m)) {
        const t = fs.find((f) => f.id === 'title')?.value.trim();
        if (t) next[k] = shared.map((f) => (f.id === 'title' ? { ...f, value: t } : f));
      }
      return next;
    });
  };
  const drawTitle =
    sheetFieldsNow.find((f) => f.id === 'title')?.value.trim() ||
    (loaded ? (drawPart !== null ? partName(drawPart) : titleFromFile(loaded.name)) : '');
  // ---------- dimensions: main dimensions + the user's own, with their own undo/redo.
  // They are in model mm, so they survive sheet and scale changes; a new file or orientation resets them.
  const [dims, setDims] = useState<Dim[]>([]);
  const [selectedDim, setSelectedDim] = useState<string | null>(null);
  const dimUndo = useRef<Dim[][]>([]);
  const dimRedo = useRef<Dim[][]>([]);
  const dimsFor = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(t);
  }, [notice]);
  const dimStore = useRef(new Map<string, Dim[]>()); // per component of the same file + orientation
  useEffect(() => {
    const key = (drawing as (DrawingData & { geomKey?: string }) | null)?.geomKey;
    if (!drawing || !key || dimsFor.current === key) return;
    const base = (k: string | null) => k?.split('|').slice(0, 2).join('|');
    if (dimsFor.current !== null) dimStore.current.set(dimsFor.current, dims);
    if (base(dimsFor.current) !== base(key)) {
      const hadOwn = [...dimStore.current.values()].some((ds) => ds.some((d) => !d.main));
      if (dimsFor.current !== null && hadOwn) setNotice('Dimensions reset: the file or orientation changed');
      dimStore.current.clear();
    }
    dimsFor.current = key;
    setDims(dimStore.current.get(key) ?? mainDims(drawing));
    dimUndo.current = [];
    dimRedo.current = [];
    setSelectedDim(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawing]);
  const changeDims = (next: Dim[]) => {
    dimUndo.current.push(dims);
    dimRedo.current = [];
    setDims(next);
  };
  const undoDims = () => {
    const prev = dimUndo.current.pop();
    if (!prev) return;
    dimRedo.current.push(dims);
    setDims(prev);
    setSelectedDim(null);
  };
  const redoDims = () => {
    const next = dimRedo.current.pop();
    if (!next) return;
    dimUndo.current.push(dims);
    setDims(next);
    setSelectedDim(null);
  };

  const sheetSvg = useMemo(
    () => (drawing && sheetFieldsNow.length ? buildSheet(drawing, sheetFieldsNow, dims.filter((d) => drawing.views[d.view]), sheetSize, drawTitle) : null),
    [drawing, sheetFieldsNow, dims, sheetSize, drawTitle],
  );
  const cells = useMemo(() => (drawing ? titleCells(drawing, sheetFieldsNow) : {}), [drawing, sheetFieldsNow]);
  const focusField = (id: string) => {
    const input = document.getElementById(`tb-${id}`);
    if (!input) return;
    input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    input.focus();
  };

  const setShownRecorded = (next: Set<number>) => {
    record();
    setShown(next);
    setIsolation(null);
  };
  const toggle = (i: number) => {
    const next = new Set(shown);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setShownRecorded(next);
  };
  const showAll = () => setShownRecorded(new Set(loaded?.parts.map((p) => p.index) ?? []));
  const isolate = (i: number) => {
    record();
    setIsolation({ part: i, before: sorted(shown) });
    setShown(new Set([i]));
    setSelected(i);
  };
  const unisolate = () => {
    if (!isolation) return;
    record();
    setShown(new Set(isolation.before));
    setIsolation(null);
  };
  const hide = (i: number) => {
    const next = new Set(shown);
    next.delete(i);
    setShownRecorded(next);
    setSelected(null);
  };

  const selectInList = (i: number) => {
    setSelected(i);
    requestAnimationFrame(() => document.getElementById(`part-row-${i}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  const onPartAction = (action: PartAction, i: number) => {
    if (action === 'isolate') isolate(i);
    else if (action === 'unisolate') unisolate();
    else if (action === 'hide') hide(i);
    else if (action === 'select') selectInList(i);
    else if (action === 'download') downloadPart(i);
    else if (action === 'showAll') showAll();
  };

  // ---------- orientation

  const rotate = (axis: number, delta: number) => {
    record();
    lastTurn.current = { axis, delta };
    setRot((r) => r.map((a, i) => (i === axis ? wrapAngle(a + delta) : a)) as Rot);
  };
  const resetRot = () => {
    if (rot.every((a) => a === 0)) return;
    record();
    setRot([0, 0, 0]);
  };

  // Keyboard: Ctrl+Z / Ctrl+Shift+Z, I isolate/unisolate, H hide, ⇧H show all, Esc deselect
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((t instanceof Element && t.closest('input, textarea, [contenteditable]')) || !loaded) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        if (appMode === 'drawing') (e.shiftKey ? redoDims : undoDims)();
        else if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        (appMode === 'drawing' ? redoDims : redo)();
        return;
      }
      if (appMode === 'drawing') return;
      if (e.metaKey || e.ctrlKey || e.altKey || !isAssembly) return;
      if (e.key === 'Escape') setSelected(null);
      else if (k === 'h' && e.shiftKey) showAll();
      else if (k === 'i' && isolation) unisolate();
      else if (k === 'i' && selected !== null) isolate(selected);
      else if (k === 'h' && selected !== null) hide(selected);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // ---------- download: exactly the parts in the preview, as vector drawings made on demand

  const selectedViews = VIEWS.filter((v) => views.has(v.id)).map((v) => v.id);
  const separate = isAssembly && mode === 'each';
  const fileCount = selectedViews.length * (separate ? drawn.length : 1);
  const canDownload = !!loaded && !nothingToDraw && fileCount > 0 && !downloading;
  const ext = fileCount > 1 ? '.zip' : '.svg';

  const summary = !loaded
    ? 'No drawings selected'
    : nothingToDraw
      ? 'No parts shown'
      : selectedViews.length === 0
        ? 'No views selected'
        : separate
          ? `${plural(drawn.length, 'part')} × ${plural(selectedViews.length, 'view')} = ${plural(fileCount, 'file')} (${ext})`
          : isAssembly && drawn.length < partCount
            ? `${drawn.length} of ${partCount} parts · ${plural(fileCount, 'drawing')} (${ext})`
            : `${plural(fileCount, 'drawing')} (${ext})`;

  const runExport = async (viewsToExport: View[], partsToExport: number[] | null, perPart: boolean) => {
    if (!file || !loaded) return;
    setDownloading(true);
    setError(null);
    try {
      await exportViews(file, loaded, viewsToExport, rot, partsToExport, perPart);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };
  const download = () => canDownload && runExport(selectedViews, partsParam, separate);
  // "Download this part": the ticked views (or the previewed view if none), named after the part
  const downloadPart = (i: number) => runExport(selectedViews.length ? selectedViews : [preview], [i], true);

  const drawEach = isAssembly && mode === 'each';
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const canDownloadDrawing = drawEach
    ? !!loaded && !!file && drawn.length > 0 && !downloading && fields.length > 0
    : !!sheetSvg && !drawingLoading && !downloading;

  /** "Each part separately": one sheet per ticked part (same views, sheet and title block; the title is
   *  the part name, dimensions are the ones made for that part or its main dimensions), zipped. */
  const downloadEachDrawing = async () => {
    if (!loaded || !file || !drawn.length) return;
    setDownloading(true);
    setError(null);
    setBatch({ done: 0, total: drawn.length });
    try {
      const { zipSync, strToU8 } = await import('fflate');
      const files: Record<string, Uint8Array> = {};
      const names = new Set<string>();
      const sheets: ({ svg: string; w: number; h: number } | undefined)[] = [];
      const views = ['front', ...(['top', 'right', 'iso'] as const).filter((v) => drawViews.has(v))] as DrawingParams['views'];
      let done = 0;
      const one = async (i: number) => {
        const params: DrawingParams = { rot, parts: [i], views, sheet: sheetSize, orient, scale: scaleOpt };
        const key = loaded.id + JSON.stringify(params);
        let d = drawingCache.current.get(key);
        if (!d) {
          d = await fetchDrawing(file, loaded.id, params);
          (d as DrawingData & { geomKey?: string }).geomKey = `${loaded.id}|${rot.join(',')}|${i}`;
          drawingCache.current.set(key, d);
        }
        const gk = `${loaded.id}|${rot.join(',')}|${i}`;
        const own = gk === dimsFor.current ? dims : dimStore.current.get(gk);
        const ds = (own ?? mainDims(d)).filter((x) => d!.views[x.view]);
        const fs = fieldsFor(String(i)); // that sheet's own title block (or the shared one)
        const title = fs.find((f) => f.id === 'title')?.value.trim() || partName(i);
        const svg = buildSheet(d, fs, ds, sheetSize, title);
        if (drawFormat === 'pdf1') {
          sheets[drawn.indexOf(i)] = { svg, w: d.sheet.w, h: d.sheet.h }; // pages in list order
          setBatch({ done: ++done, total: drawn.length });
          return;
        }
        let base = 'DRW_' + title.replace(/[^\w.-]+/g, '_');
        for (let n = 2; names.has(base); n++) base = `DRW_${title.replace(/[^\w.-]+/g, '_')}_${n}`;
        names.add(base);
        files[base + '.' + drawFormat] =
          drawFormat === 'svg'
            ? strToU8('<?xml version="1.0" encoding="UTF-8"?>\n' + svg)
            : new Uint8Array(await (await sheetToPdf(svg, d.sheet.w, d.sheet.h)).arrayBuffer());
        setBatch({ done: ++done, total: drawn.length });
      };
      // two at a time: fast enough, and gentle on the (free) server
      const queue = [...drawn];
      await Promise.all(
        [0, 1].map(async () => {
          for (let i = queue.shift(); i !== undefined; i = queue.shift()) await one(i);
        }),
      );
      const stem = titleFromFile(loaded.name).replace(/[^\w.-]+/g, '_');
      if (drawFormat === 'pdf1') {
        saveBlob(await sheetsToPdf(sheets.filter((x): x is { svg: string; w: number; h: number } => !!x)), `DRW_${stem}_parts.pdf`);
        return;
      }
      const entries = Object.entries(files);
      if (entries.length === 1) {
        const [name, data] = entries[0];
        saveBlob(new Blob([data as BlobPart], { type: drawFormat === 'svg' ? 'image/svg+xml' : 'application/pdf' }), name);
      } else {
        saveBlob(new Blob([zipSync(files, { level: 6 }) as BlobPart], { type: 'application/zip' }), `DRW_${stem}_parts.zip`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make the drawings');
    } finally {
      setDownloading(false);
      setBatch(null);
    }
  };

  const downloadDrawing = async () => {
    if (drawEach) return downloadEachDrawing();
    if (!sheetSvg || !drawing) return;
    const base = 'DRW_' + (drawTitle || 'drawing').replace(/[^\w.-]+/g, '_');
    if (drawFormat === 'svg') {
      saveBlob(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + sheetSvg], { type: 'image/svg+xml' }), base + '.svg');
      return;
    }
    setDownloading(true);
    try {
      saveBlob(await sheetToPdf(sheetSvg, drawing.sheet.w, drawing.sheet.h), base + '.pdf');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make the PDF');
    } finally {
      setDownloading(false);
    }
  };
  const inDrawing = appMode === 'drawing';

  const allViews = views.size === VIEWS.length;
  const allShown = shown.size === partCount;
  const hiddenCount = partCount - shown.size;

  const isolationLabel = !isAssembly
    ? null
    : isolation
      ? `Isolated: ${partName(isolation.part)}`
      : hiddenCount > 0
        ? `${plural(hiddenCount, 'part')} hidden`
        : null;

  return (
    <div className="relative flex h-dvh w-full">
      <input
        ref={inputRef}
        type="file"
        accept=".step,.stp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = '';
        }}
      />

      {/* Panel toggle: a tab on the outside of the panel's edge (or the window's); points in to hide, out to show */}
      <button
        type="button"
        onClick={() => setPanelOpen(!panelOpen)}
        aria-label={panelOpen ? 'Hide panel' : 'Show panel'}
        title={panelOpen ? 'Hide panel' : 'Show panel'}
        className={`absolute top-1/2 z-20 flex h-11 w-5 -translate-y-1/2 items-center justify-center border border-border bg-surface text-fg-2 shadow-[0_2px_8px_rgb(0_0_0/0.12)] transition-[left,border-radius] duration-200 ease-[cubic-bezier(0.3,0.7,0.2,1)] rounded-r-lg border-l-0 hover:bg-surface-hover hover:text-fg`}
        style={{ left: panelOpen ? 328 : 0 }}
      >
        <Chevron className={panelOpen ? 'rotate-90' : '-rotate-90'} />
      </button>

      {/* ---------- left panel */}
      <div
        className={`relative z-10 h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-[cubic-bezier(0.3,0.7,0.2,1)] ${panelOpen ? 'w-[328px]' : 'w-0'}`}
        aria-hidden={!panelOpen}
        inert={!panelOpen}
      >
      <aside className="relative flex h-full w-[328px] flex-col gap-2.5 border-r border-panel-border bg-panel px-4 py-5 shadow-panel">
        <div className="flex shrink-0 items-center gap-2.5 px-1 pb-2.5">
          <Logo className="text-fg" />
          <span className="flex-1 text-[17px] font-medium">OUTLINER</span>
          <ThemeToggle />
        </div>

        <Segmented
          label="Mode"
          value={appMode}
          onChange={(m) => {
            setAppMode(m);
            setFocusedField(null);
          }}
          options={[
            { key: 'lineart', label: 'Line art' },
            { key: 'drawing', label: 'Drawing' },
          ]}
          className="w-full shrink-0 gap-0.5 rounded-[10px] border border-border bg-surface p-[3px] [--seg-pad:3px] [--seg-radius:7px]"
          thumbClass="bg-fill"
          segmentClass="flex h-[30px] flex-1 items-center justify-center rounded-[7px] text-[13px]"
        />

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1">
          {/* The whole File card opens the file picker */}
          <button
            type="button"
            onClick={browse}
            disabled={!!loadingName}
            aria-label={loaded ? `Replace file ${loaded.name}` : 'Choose a STEP file'}
            className="group flex w-full shrink-0 flex-col gap-1.5 rounded-[10px] border border-border bg-surface px-3 py-3.5 text-left hover:border-fg-3/70 hover:bg-surface-hover disabled:cursor-progress"
          >
            <span className="flex w-full items-center gap-2 px-1 pb-1">
              <span className="flex-1 text-[13px] font-medium">File</span>
              {loaded && <span className="text-[12px] text-fg-2 group-hover:text-accent">Replace</span>}
            </span>
            {loaded ? (
              <span className="flex w-full items-center gap-2.5 px-1">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-fill text-[8px] text-fg-2">STP</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[12px] font-medium" title={loaded.name}>
                    {loaded.name}
                  </span>
                  <span className="text-[11px] text-fg-3">
                    {formatSize(loaded.size)} · {plural(partCount, 'part')}
                  </span>
                </span>
              </span>
            ) : (
              <span className="px-1 text-[12px] text-fg-3">No file yet — drop a STEP file anywhere</span>
            )}
          </button>

          {(!loaded || isAssembly) && (
            <Card
              title="Parts"
              action={
                isAssembly && (
                  <LinkButton onClick={() => setShownRecorded(allShown ? new Set() : new Set(loaded!.parts.map((p) => p.index)))}>
                    {allShown ? 'Clear' : 'Select all'}
                  </LinkButton>
                )
              }
            >
              {!loaded ? (
                <p className="px-1 text-[12px] text-fg-3">Listed when a file is loaded</p>
              ) : (
                <>
                  <div className="-mr-2 flex max-h-[232px] flex-col gap-1.5 overflow-y-auto pr-2">
                    {loaded.parts.map((p) => (
                      <PartRow
                        key={p.index}
                        index={p.index}
                        name={p.name}
                        title={p.id}
                        checked={shown.has(p.index)}
                        selected={inDrawing ? drawPart === p.index : selected === p.index}
                        onToggle={() => toggle(p.index)}
                        onSelect={() =>
                          inDrawing
                            ? setDrawPart(drawPart === p.index ? null : p.index)
                            : setSelected(selected === p.index ? null : p.index)
                        }
                      />
                    ))}
                  </div>
                </>
              )}
            </Card>
          )}

          {inDrawing && (
            <>
              <Card title="Views" action={<span className="text-[12px] text-fg-3">3rd angle</span>}>
                <div className="flex flex-wrap gap-1.5 px-1">
                  <Chip label="Front" selected onClick={() => {}} disabled={!loaded} />
                  {(['top', 'right', 'iso'] as const).map((v) => (
                    <Chip
                      key={v}
                      label={v === 'iso' ? 'ISO' : v[0].toUpperCase() + v.slice(1)}
                      selected={drawViews.has(v)}
                      disabled={!loaded}
                      onClick={() => {
                        const next = new Set(drawViews);
                        if (next.has(v)) next.delete(v);
                        else next.add(v);
                        setDrawViews(next);
                      }}
                    />
                  ))}
                </div>
              </Card>
              <Card title="Sheet">
                <div className="flex items-center gap-1.5 px-1">
                  {(['A4', 'A3'] as const).map((k) => (
                    <Chip key={k} label={k} selected={sheetSize === k} onClick={() => setSheetSize(k)} />
                  ))}
                  <span className="mx-0.5 h-[18px] w-px bg-border" aria-hidden />
                  {(['landscape', 'portrait'] as const).map((k) => (
                    <Chip key={k} label={k === 'landscape' ? 'Landscape' : 'Portrait'} selected={orient === k} onClick={() => setOrient(k)} />
                  ))}
                </div>
                <div className="flex items-center gap-1.5 px-1">
                  <span className="flex-1 text-[12px] text-fg-2">Scale</span>
                  <Chip label={drawing ? `Auto · ${drawing.autoScale}` : 'Auto'} selected={scaleOpt === 'auto'} onClick={() => setScaleOpt('auto')} />
                  {/* any standard scale, as long as the views and dimensions fit the sheet */}
                  <div className="relative">
                    <Chip
                      label={scaleOpt === 'auto' ? 'Choose' : scaleOpt}
                      selected={scaleOpt !== 'auto'}
                      disabled={!drawing}
                      onClick={() => setScaleMenu((o) => !o)}
                    />
                    {scaleMenu && drawing && (
                      <Menu
                        className="top-9 right-0 max-h-[50vh] overflow-y-auto"
                        items={Object.entries(drawing.options).map(([k, ok]) => ({
                          key: k,
                          label: k,
                          meta: k === drawing.autoScale ? 'auto' : undefined,
                          disabled: !ok,
                          title: ok ? undefined : `Does not fit on ${sheetSize}`,
                        }))}
                        active={scaleOpt === 'auto' ? drawing.autoScale : scaleOpt}
                        onSelect={(k) => {
                          setScaleOpt(k);
                          setScaleMenu(false);
                        }}
                        onClose={() => setScaleMenu(false)}
                      />
                    )}
                  </div>
                </div>
              </Card>
              {fields.length > 0 && (
                <TitleBlockCard
                  fields={sheetFieldsNow}
                  onFields={setSheetFieldsNow}
                  onApplyAll={isAsm ? applyToAllSheets : undefined}
                  titlePlaceholder={loaded ? (drawPart !== null ? partName(drawPart) : titleFromFile(loaded.name)) : 'Title'}
                  autoValues={{ scale: drawing?.scaleLabel ?? '—', format: sheetSize, unit: 'mm' }}
                  focused={focusedField}
                  onFocusField={setFocusedField}
                />
              )}
            </>
          )}

          {!inDrawing && (
          <Card
            title="Views"
            action={
              loaded && (
                <LinkButton onClick={() => setViews(allViews ? new Set() : new Set(VIEWS.map((v) => v.id)))}>
                  {allViews ? 'Clear' : 'Select all'}
                </LinkButton>
              )
            }
          >
            {VIEWS.map((v) => (
              <CheckboxRow
                key={v.id}
                label={v.label}
                meta={v.meta}
                checked={!!loaded && views.has(v.id)}
                disabled={!loaded}
                onChange={(on) => {
                  const next = new Set(views);
                  if (on) next.add(v.id);
                  else next.delete(v.id);
                  setViews(next);
                }}
              />
            ))}
          </Card>
          )}
        </div>

        {/* ---------- download (pinned; the cards above scroll under a soft fade) */}
        <div className="relative flex shrink-0 flex-col gap-2">
          {/* Assemblies: download the whole assembly, or each ticked part on its own */}
          {loaded && isAssembly && <ModeToggle mode={mode} onChange={setMode} />}
          {(() => {
            const can = inDrawing ? canDownloadDrawing : canDownload;
            return (
              <div className={`flex h-11 w-full items-stretch overflow-hidden rounded-lg bg-accent text-on-accent ${can || downloading ? '' : 'opacity-35'}`}>
                <button
                  type="button"
                  onClick={inDrawing ? downloadDrawing : download}
                  disabled={!can}
                  className="flex min-w-0 flex-1 items-center gap-2 pl-4 text-left text-[14px] font-medium enabled:hover:bg-black/10 enabled:active:bg-black/15 disabled:cursor-default"
                >
                  <DownloadIcon className={downloading ? 'animate-bounce' : ''} />
                  <span className="truncate">
                    {inDrawing
                      ? batch
                        ? `Preparing ${batch.done + 1 > batch.total ? batch.total : batch.done + 1} of ${batch.total}…`
                        : downloading
                          ? 'Preparing PDF…'
                          : drawEach && drawn.length > 1
                            ? `Download ${plural(drawn.length, 'drawing')}`
                            : 'Download drawing'
                      : downloading
                        ? 'Preparing drawings…'
                        : canDownload
                          ? `Download ${plural(fileCount, 'drawing')}`
                          : 'Download'}
                  </span>
                </button>
                <span className="w-px bg-on-accent/25" aria-hidden />
                <button
                  type="button"
                  onClick={() => setFormatMenu((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={formatMenu}
                  aria-label="Choose format"
                  className="flex items-center gap-1 px-3 text-[12px] font-medium hover:bg-black/10 active:bg-black/15"
                >
                  {inDrawing ? (drawFormat === 'svg' ? 'SVG' : 'PDF') : 'SVG'}
                  <Chevron />
                </button>
              </div>
            );
          })()}
          {formatMenu && (
            <Menu
              className="right-0 bottom-[74px]"
              items={
                inDrawing
                  ? drawEach && drawn.length > 1
                    ? [
                        { key: 'svg', label: 'SVG', meta: 'one per part' },
                        { key: 'pdf', label: 'PDF', meta: 'one per part' },
                        { key: 'pdf1', label: 'PDF', meta: 'all in one file' },
                      ]
                    : [
                        { key: 'svg', label: 'SVG', meta: 'vector' },
                        { key: 'pdf', label: 'PDF', meta: 'vector' },
                      ]
                  : FORMATS
              }
              active={inDrawing ? (drawFormat === 'pdf1' && !(drawEach && drawn.length > 1) ? 'pdf' : drawFormat) : 'svg'}
              onSelect={(k) => {
                if (inDrawing) setDrawFormat(k as 'svg' | 'pdf' | 'pdf1');
                setFormatMenu(false);
              }}
              onClose={() => setFormatMenu(false)}
            />
          )}
          <p className="px-0.5 text-[11px] text-fg-3">Designed by William Stadheim</p>
        </div>
      </aside>
      </div>

      {inDrawing && loaded ? (
        <DrawingView
          drawing={drawing}
          sheetSvg={nothingToDraw ? null : sheetSvg}
          loading={drawingLoading || downloading}
          error={drawingError ?? error}
          cells={cells}
          focusedField={focusedField}
          onSwapFields={(a, b) => {
            const ia = sheetFieldsNow.findIndex((f) => f.id === a), ib = sheetFieldsNow.findIndex((f) => f.id === b);
            if (ia < 0 || ib < 0) return;
            const next = [...sheetFieldsNow];
            [next[ia], next[ib]] = [next[ib], next[ia]];
            setSheetFieldsNow(next);
          }}
          fieldLabels={Object.fromEntries(sheetFieldsNow.map((f) => [f.id, f.label.toUpperCase()]))}
          onFieldClick={(id) => {
            setFocusedField(id);
            focusField(id);
          }}
          notice={notice}
          dims={dims}
          selectedDim={selectedDim}
          onSelectDim={setSelectedDim}
          onAddDim={(d) => {
            changeDims([...dims, d]);
            setSelectedDim(null);
          }}
          onRemoveDim={(id) => {
            changeDims(dims.filter((d) => d.id !== id));
            if (selectedDim === id) setSelectedDim(null);
          }}
          canUndo={dimUndo.current.length > 0}
          canRedo={dimRedo.current.length > 0}
          onUndo={undoDims}
          onRedo={redoDims}
          fileKey={loaded.id}
          components={isAssembly ? [{ key: 'all', label: 'Whole assembly' }, ...loaded.parts.map((p) => ({ key: String(p.index), label: p.name }))] : null}
          component={drawPart === null ? 'all' : String(drawPart)}
          onComponent={(k) => setDrawPart(k === 'all' ? null : Number(k))}
          onShowPanel={undefined}
        />
      ) : (
      <Preview
        hasModel={!!loaded}
        fillMesh={fillMesh && fillMesh.id === loaded?.id ? fillMesh.mesh : null}
        parts={drawn}
        fileName={loaded?.name ?? null}
        loadingName={loadingName}
        dragging={dragging}
        svg={nothingToDraw ? null : svg}
        rendering={rendering}
        preparing={downloading ? `Preparing ${plural(fileCount || 1, 'vector drawing')}…` : null}
        message={nothingToDraw ? 'No parts shown — tick parts in the list' : null}
        error={error}
        view={preview}
        onView={setPreview}
        rot={rot}
        step={step}
        onRotate={rotate}
        onStep={setStep}
        onReset={resetRot}
        onBrowse={browse}
        selectable={isAssembly}
        selected={selected}
        isolated={isolation?.part ?? null}
        partName={partName}
        onSelect={(i) => (i === null ? setSelected(null) : selectInList(i))}
        onPartAction={onPartAction}
        isolationLabel={isolationLabel}
        isolationAction={isolation ? 'Unisolate' : 'Show all'}
        onIsolationAction={isolation ? unisolate : showAll}
        canUndo={undoStack.current.length > 0}
        canRedo={redoStack.current.length > 0}
        onUndo={undo}
        onRedo={redo}
        onShowPanel={undefined}
      />
      )}
    </div>
  );
}
