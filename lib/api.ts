import { parseFillMesh, type FillMesh } from './lightFill';
import type { DrawingData } from './sheet';
import type { Rot, View } from './views';

/** `id` is the full assembly path from the STEP file; `name` is the readable last segment. */
export type Part = { index: number; id: string; name: string };
/** heavy: too big for exact lines at every angle; the preview shows the GPU lines, exact on download. */
export type LoadedFile = { id: string; name: string; size: number; parts: Part[]; heavy?: boolean };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function check(res: Response): Promise<Response> {
  if (res.ok) return res;
  let msg = `Request failed (${res.status})`;
  try {
    const j = await res.json();
    if (typeof j.detail === 'string') msg = j.detail;
  } catch {}
  throw new ApiError(res.status, msg);
}

/** Uploads the STEP file and returns its id and part list. */
export async function uploadFile(file: File, signal?: AbortSignal): Promise<LoadedFile> {
  const body = new FormData();
  body.append('file', await packed(file), file.name);
  const res = await check(await fetch('/api/parts', { method: 'POST', body, signal }));
  return res.json();
}

/** STEP is text and shrinks ~5x: gzip it so files up to ~20 MB fit Vercel's 4.5 MB request limit.
 *  (The server sees the gzip header and unpacks it; the id is the hash of the unpacked file.) */
const packedCache = new WeakMap<File, Promise<Blob>>();
/** The gzipped file, made once per file (it is sent again whenever an instance doesn't know it). */
function packed(file: File): Promise<Blob> {
  let p = packedCache.get(file);
  if (!p) packedCache.set(file, (p = gzipped(file)));
  return p;
}
async function gzipped(file: File): Promise<Blob> {
  if (typeof CompressionStream === 'undefined' || file.size < 64 * 1024) return file;
  try {
    return await new Response(file.stream().pipeThrough(new CompressionStream('gzip'))).blob();
  } catch {
    return file;
  }
}

function post(path: string, payload: unknown, signal?: AbortSignal) {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  }).then(check);
}

/**
 * Calls the API, re-uploading the STEP file once if this server instance no longer has it cached
 * (serverless cold start or a different instance).
 */
async function withFile(file: File, id: string, path: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  try {
    return await post(path, { ...payload, id }, signal);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
    // Send the file with the request, so the same instance loads it and answers: a separate
    // re-upload could land on yet another instance and miss again.
    const body = new FormData();
    body.append('file', await packed(file), file.name);
    body.append('op', path);
    body.append('body', JSON.stringify(payload));
    return check(await fetch('/api/with-file', { method: 'POST', body, signal }));
  }
}

/** The exact HLR drawing for the preview: the same SVG as the download (lines only). The solid fill
 *  under it is drawn in the browser from the fill mesh (fetchFillMesh), so new angles stay small. */
/** offsets: exploded view, part index → [dx, dy, dz] model mm (undefined = assembled). */
export type Offsets = Record<number, number[]> | undefined;

export function renderView(file: File, id: string, view: View, rot: Rot, parts: number[] | null, signal?: AbortSignal, offsets?: Offsets) {
  // preview: the server drops it (409) if you click on to another angle before it is done
  return withFile(file, id, '/api/render', { view, rot, parts, preview: true, offsets }, signal).then((r) => r.text());
}

/** A guessed next angle: the server draws it without ever delaying a real request (and drops it,
 *  409, when one comes in). Never re-uploads the file: a guess isn't worth it. */
export function renderGuess(id: string, view: View, rot: Rot, parts: number[] | null, signal?: AbortSignal, offsets?: Offsets) {
  return post('/api/render', { id, view, rot, parts, background: true, offsets }, signal).then((r) => r.text());
}

/** Fine mesh + real edges of every part, once per file (binary; see /api/scene). */
export function fetchFillMesh(file: File, id: string, signal?: AbortSignal): Promise<FillMesh> {
  return withFile(file, id, '/api/scene', {}, signal)
    .then((r) => r.arrayBuffer())
    .then(parseFillMesh);
}

export async function exportViews(
  file: File,
  loaded: LoadedFile,
  views: View[],
  rot: Rot,
  parts: number[] | null,
  separate = false,
  offsets?: Offsets,
) {
  const res = await withFile(file, loaded.id, '/api/export', { views, rot, parts, separate, format: 'svg', name: loaded.name, offsets });
  const blob = await res.blob();
  const disp = res.headers.get('content-disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disp)?.[1] ?? (views.length > 1 ? 'drawings.zip' : 'drawing.svg');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Whether the API runs a local prefetch pool (only when started with `npm run api`). */
export async function apiHealth(): Promise<{ ok: boolean; prefetch: boolean }> {
  try {
    return await fetch('/api/health').then((r) => r.json());
  } catch {
    return { ok: false, prefetch: false };
  }
}

/** Local only: ask the pool to draw neighbouring angles and the other ticked views. Fire and forget. */
export function prefetchViews(id: string, view: View, rot: Rot, step: number, parts: number[] | null, views: View[]) {
  post('/api/prefetch', { id, view, rot, step, parts, views }).catch(() => {});
}

export type DrawingParams = {
  rot: Rot;
  parts: number[] | null;
  views: ('front' | 'top' | 'right' | 'iso')[];
  sheet: 'A4' | 'A3';
  orient: 'landscape' | 'portrait';
  scale: string; // 'auto' or a standard scale such as '1:5' (must fit the sheet)
  /** Exploded drawing: one ISO of the moved parts, with room for balloons and a legend. */
  exploded?: boolean;
  offsets?: Offsets;
  legend_rows?: number;
};

/** Views for the production drawing: exact HLR polylines in mm and where they go on the sheet. */
export function fetchDrawing(file: File, id: string, p: DrawingParams, signal?: AbortSignal): Promise<DrawingData> {
  return withFile(file, id, '/api/drawing', { ...p }, signal).then((r) => r.json());
}
