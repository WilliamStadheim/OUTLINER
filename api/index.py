"""Outliner API: a thin FastAPI wrapper around outliner_core.

    GET  /api/health                                      -> {ok, prefetch}
    POST /api/parts    multipart `file` (STEP)            -> {id, name, size, parts: [{index, id, name}]}
    POST /api/render   {id, view, rot, parts?, fill?}     -> image/svg+xml
    POST /api/prefetch {id, view, rot, step, parts?, views?, fill?}  (local only, see below)
    POST /api/export   {id, views, rot, parts?, separate?} -> one .svg, or a .zip (per view, or per part × view)

`id` is a content hash of the STEP file. Loaded parts are cached per id (loading is the slow step).
If an instance doesn't know an id (cold start, another serverless instance), it answers 404 with
detail "unknown-file" and the client uploads the file again.

Speed: rendered SVGs are cached by camera (different rotations that give the same camera share
one drawing), and the preview fill is meshed once per file. With OUTLINER_PREFETCH=1 (set by
`npm run api`, i.e. only when running locally) a process pool also draws neighbouring angles in the
background. On Vercel there is no pool; the client fetches the next angle itself.
"""
import hashlib
import io
import os
import re
import sys
import tempfile
import threading
import zipfile
from collections import OrderedDict
from concurrent.futures import ProcessPoolExecutor

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import outliner_core as core  # noqa: E402

app = FastAPI(title='Outliner', docs_url='/api/docs', openapi_url='/api/openapi.json')

MAX_FILES = 8                      # cached STEP models per instance
MAX_SVG_BYTES = 200 * 1024 * 1024  # rendered views kept per instance
TMP = os.path.join(tempfile.gettempdir(), 'outliner')
os.makedirs(TMP, exist_ok=True)
PREFETCH = os.environ.get('OUTLINER_PREFETCH') == '1'

_models: 'OrderedDict[str, dict]' = OrderedDict()
_svgs: 'OrderedDict[tuple, str]' = OrderedDict()
_svg_bytes = 0
_lock = threading.Lock()        # OCC is not reliably thread-safe; one geometry job at a time
_cache_lock = threading.Lock()  # guards _svgs (also written by the prefetch pool's callbacks)


class RenderReq(BaseModel):
    id: str
    view: str = 'iso'
    rot: tuple[float, float, float] = (0, 0, 0)
    parts: list[int] | None = None
    fill: str | None = None   # e.g. "#1C1C1C" in the preview; exports stay transparent


class PrefetchReq(RenderReq):
    step: float = 90
    views: list[str] = []     # other ticked views, drawn at the current orientation


class ExportReq(BaseModel):
    id: str
    views: list[str] = Field(min_length=1)
    rot: tuple[float, float, float] = (0, 0, 0)
    parts: list[int] | None = None
    format: str = 'svg'
    name: str = 'model'   # original file name, used for the download file names
    separate: bool = False  # True: one SVG per part × view ("Each part separately")


# ---------- caches

def _model(fid: str) -> dict:
    m = _models.get(fid)
    if m is None:
        raise HTTPException(404, 'unknown-file')
    _models.move_to_end(fid)
    return m


def _key(fid, view, rot, only, fill):
    return (fid, core.camera_key(view, rot), only, fill)


def _cache_get(key):
    with _cache_lock:
        svg = _svgs.get(key)
        if svg is not None:
            _svgs.move_to_end(key)
        return svg


def _cache_put(key, svg):
    global _svg_bytes
    with _cache_lock:
        if key in _svgs:
            return
        _svgs[key] = svg
        _svg_bytes += len(svg)
        while _svg_bytes > MAX_SVG_BYTES and len(_svgs) > 1:
            _, old = _svgs.popitem(last=False)
            _svg_bytes -= len(old)


def _drop_file(fid):
    global _svg_bytes
    with _cache_lock:
        for k in [k for k in _svgs if k[0] == fid]:
            _svg_bytes -= len(_svgs.pop(k))
    try:
        os.remove(os.path.join(TMP, fid + '.step'))
    except OSError:
        pass


def _norm(view, rot, parts, fill):
    if view not in core.VIEWS:
        raise HTTPException(422, f'Unknown view "{view}"')
    if fill is not None and not re.fullmatch(r'#[0-9a-fA-F]{3,8}', fill):
        raise HTTPException(422, 'fill must be a hex colour')
    rot = tuple(round(float(a), 6) % 360 for a in rot)
    only = None if parts is None else tuple(sorted(set(parts)))
    return rot, only


def _svg(fid: str, view: str, rot, parts, fill: str | None = None) -> str:
    rot, only = _norm(view, rot, parts, fill)
    key = _key(fid, view, rot, only, fill)
    svg = _cache_get(key)
    if svg is not None:
        return svg
    with _lock:
        svg = _cache_get(key)   # drawn by someone else while we waited
        if svg is not None:
            return svg
        m = _model(fid)
        if only is not None and any(i < 0 or i >= len(m['parts']) for i in only):
            raise HTTPException(422, 'Part index out of range')
        if fill and 'fill' not in m:
            m['fill'] = core.fill_mesh(m['parts'])   # once per file
        try:
            svg = core.render(m['parts'], view, rot, only=only, fill=fill, fill_cache=m.get('fill') if fill else None)
        except ValueError as e:
            raise HTTPException(422, str(e))
    _cache_put(key, svg)
    return svg


def part_label(path: str, i: int) -> str:
    """Readable part name: the last path segment without the instance suffix
    ("Panel_Side_L:1/Panel_Side_L" -> "Panel_Side_L")."""
    for seg in reversed([p for p in path.split('/') if p.strip()]):
        seg = re.sub(r':\d+$', '', seg.strip())
        if seg:
            return seg
    return f'Part {i + 1}'


# ---------- local prefetch pool (OUTLINER_PREFETCH=1)

_worker_models: 'OrderedDict[str, tuple]' = OrderedDict()   # per worker process


def _pool_render(path, fid, view, rot, only, fill):
    """Runs in a pool process: same load + render as the main process, so the output is identical."""
    m = _worker_models.get(fid)
    if m is None:
        parts = core.load(path)
        m = (parts, core.fill_mesh(parts) if fill else None)
        _worker_models[fid] = m
        while len(_worker_models) > 2:
            _worker_models.popitem(last=False)
    parts, fm = m
    if fill and fm is None:
        fm = core.fill_mesh(parts)
        _worker_models[fid] = (parts, fm)
    return core.render(parts, view, rot, only=only, fill=fill, fill_cache=fm if fill else None)


class _Prefetcher:
    """Feeds a process pool from a priority list. A new request replaces the waiting list; jobs
    already running finish and land in the cache."""

    def __init__(self):
        self.pool = None
        self.workers = max(1, min(4, (os.cpu_count() or 2) - 1))
        self.queue: list[tuple] = []
        self.running: set = set()
        self.lock = threading.Lock()

    def submit(self, jobs):
        with self.lock:
            if self.pool is None:
                self.pool = ProcessPoolExecutor(self.workers)
            self.queue = [j for j in dict.fromkeys(jobs) if j[0] not in self.running and _cache_get(j[0]) is None]
        self._pump()

    def _pump(self):
        with self.lock:
            while self.queue and len(self.running) < self.workers:
                key, args = self.queue.pop(0)
                if key in self.running or _cache_get(key) is not None:
                    continue
                self.running.add(key)
                fut = self.pool.submit(_pool_render, *args)
                fut.add_done_callback(lambda f, k=key: self._done(k, f))

    def _done(self, key, fut):
        with self.lock:
            self.running.discard(key)
        try:
            _cache_put(key, fut.result())
        except Exception:
            pass
        self._pump()


_prefetcher = _Prefetcher() if PREFETCH else None


def _orientations(rot, step):
    """Neighbours first (±step about X, Y, Z); for 90° steps then every distinct 90° orientation."""
    out = []
    for axis in range(3):
        for sign in (1, -1):
            r = list(rot); r[axis] = (r[axis] + sign * step) % 360; out.append(tuple(r))
    if abs(step - 90) < 1e-9:
        out += [(a, b, c) for a in (0, 90, 180, 270) for b in (0, 90, 180, 270) for c in (0, 90, 180, 270)]
    return out


# ---------- endpoints

@app.get('/api/health')
def health():
    return {'ok': True, 'prefetch': PREFETCH}


@app.post('/api/parts')
def parts(file: UploadFile = File(...)):
    data = file.file.read()
    if not data:
        raise HTTPException(422, 'Empty file')
    fid = hashlib.sha256(data).hexdigest()[:20]
    name = os.path.basename(file.filename or 'model.step')
    with _lock:
        m = _models.get(fid)
        if m is None:
            path = os.path.join(TMP, fid + '.step')
            with open(path, 'wb') as f:
                f.write(data)   # kept while the model is cached: the prefetch pool reads it
            try:
                loaded = core.load(path)
            except ValueError as e:
                _drop_file(fid)
                raise HTTPException(422, str(e))
            except Exception:
                _drop_file(fid)
                raise HTTPException(422, 'Could not read this STEP file')
            m = {'parts': loaded}
            _models[fid] = m
            while len(_models) > MAX_FILES:
                old, _ = _models.popitem(last=False)
                _drop_file(old)
        _models.move_to_end(fid)
    return {'id': fid, 'name': name, 'size': len(data),
            'parts': [{'index': i, 'id': n, 'name': part_label(n, i)} for i, (n, _) in enumerate(m['parts'])]}


@app.post('/api/render')
def render(req: RenderReq):
    return Response(_svg(req.id, req.view, req.rot, req.parts, req.fill), media_type='image/svg+xml',
                    headers={'Cache-Control': 'no-store'})


@app.post('/api/prefetch')
def prefetch(req: PrefetchReq):
    """Local only: queue neighbouring angles (and the other ticked views) for the pool."""
    if _prefetcher is None:
        return {'queued': 0, 'enabled': False}
    m = _model(req.id)
    path = os.path.join(TMP, req.id + '.step')
    rot, only = _norm(req.view, req.rot, req.parts, req.fill)
    n = len(m['parts'])
    if only is not None and any(i < 0 or i >= n for i in only):
        raise HTTPException(422, 'Part index out of range')
    jobs, seen = [], set()

    def add(view, r):
        r = tuple(round(float(a), 6) % 360 for a in r)
        key = _key(req.id, view, r, only, req.fill)
        if key not in seen:
            seen.add(key)
            jobs.append((key, (path, req.id, view, r, only, req.fill)))
    for r in _orientations(rot, req.step):
        add(req.view, r)
    for v in req.views:
        if v in core.VIEWS:
            add(v, rot)
    _prefetcher.submit(jobs)
    return {'queued': len(jobs), 'enabled': True}


def _stem(name: str) -> str:
    stem = re.sub(r'\.(step|stp)$', '', name, flags=re.I)
    return re.sub(r'[^\w.\- ]+', '_', stem).strip() or 'drawing'


@app.post('/api/export')
def export(req: ExportReq):
    if req.format != 'svg':
        raise HTTPException(422, 'Only SVG export is available so far')
    views = list(dict.fromkeys(req.views))
    stem = _stem(req.name)
    if req.separate:
        m = _model(req.id)
        idx = list(dict.fromkeys(req.parts if req.parts is not None else range(len(m['parts']))))
        if any(i < 0 or i >= len(m['parts']) for i in idx):
            raise HTTPException(422, 'Part index out of range')
        files, used = [], set()
        for i in idx:
            base = _stem(part_label(m['parts'][i][0], i))
            name, k = base, 2
            while name in used:   # two instances of the same part get _2, _3, ...
                name, k = f'{base}_{k}', k + 1
            used.add(name)
            files += [(f'{name}_{v}.svg', _svg(req.id, v, req.rot, [i])) for v in views]
    else:
        files = [(f'{stem}_{v}.svg', _svg(req.id, v, req.rot, req.parts)) for v in views]
    if len(files) == 1:
        fname, svg = files[0]
        return Response(svg, media_type='image/svg+xml',
                        headers={'Content-Disposition': f'attachment; filename="{fname}"'})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for fname, svg in files:
            z.writestr(fname, svg)
    return Response(buf.getvalue(), media_type='application/zip',
                    headers={'Content-Disposition': f'attachment; filename="{stem}.zip"'})
