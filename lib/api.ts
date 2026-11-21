import type { Rot, View } from './views';

/** Preview paints the model solid (#1C1C1C) so the grid doesn't show through. Exports stay transparent. */
const PREVIEW_FILL = '#1C1C1C';

/** `id` is the full assembly path from the STEP file; `name` is the readable last segment. */
export type Part = { index: number; id: string; name: string };
export type LoadedFile = { id: string; name: string; size: number; parts: Part[] };

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
  body.append('file', file);
  const res = await check(await fetch('/api/parts', { method: 'POST', body, signal }));
  return res.json();
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
async function withFile<T>(file: File, id: string, call: (id: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await call(id);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
    const again = await uploadFile(file, signal);
    return call(again.id);
  }
}

/** The exact HLR drawing for the preview: same renderer as the download, plus the dark fill. */
export function renderView(file: File, id: string, view: View, rot: Rot, parts: number[] | null, signal?: AbortSignal) {
  return withFile(file, id, (fid) => post('/api/render', { id: fid, view, rot, parts, fill: PREVIEW_FILL }, signal).then((r) => r.text()), signal);
}

export async function exportViews(
  file: File,
  loaded: LoadedFile,
  views: View[],
  rot: Rot,
  parts: number[] | null,
  separate = false,
) {
  const res = await withFile(file, loaded.id, (fid) =>
    post('/api/export', { id: fid, views, rot, parts, separate, format: 'svg', name: loaded.name }),
  );
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
  post('/api/prefetch', { id, view, rot, step, parts, views, fill: PREVIEW_FILL }).catch(() => {});
}
