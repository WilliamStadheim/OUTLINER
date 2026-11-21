import type { TitleField } from './sheet';

const KEY = 'outliner-titleblock-v1';
export const MAX_CELLS = 8; // fields shown in the table (4 columns × 2 rows), besides the title

const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

/** Title (empty = the file name) and the default fields, in table order. */
export function defaultFields(): TitleField[] {
  return [
    { id: 'title', label: 'Title', value: '', enabled: true },
    { id: 'qty', label: 'Qty', value: '1', enabled: true },
    { id: 'material', label: 'Material', value: '', enabled: true },
    { id: 'finish', label: 'Finish', value: '', enabled: false },
    { id: 'rev', label: 'Rev', value: 'A', enabled: true },
    { id: 'date', label: 'Date', value: today(), enabled: true },
    { id: 'scale', label: 'Scale', value: '', enabled: true, auto: 'scale' },
    { id: 'format', label: 'Format', value: '', enabled: false, auto: 'format' },
    { id: 'unit', label: 'Unit', value: '', enabled: false, auto: 'unit' },
    { id: 'drawnby', label: 'Drawn by', value: '', enabled: true },
  ];
}

export function loadFields(): TitleField[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const f = JSON.parse(raw) as TitleField[];
      if (Array.isArray(f) && f.some((x) => x.id === 'title')) return f;
    }
  } catch {}
  return defaultFields();
}

export function saveFields(f: TitleField[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f));
  } catch {}
}

/** "MagSafeHolder.step" → "MagSafeHolder", "panel_side-L.stp" → "Panel side L" (camel case is kept:
 *  splitting it guesses wrong too often, e.g. "MagSafe"). */
export function titleFromFile(name: string) {
  const stem = name.replace(/\.(step|stp)$/i, '').replace(/[_-]+/g, ' ').trim();
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}
