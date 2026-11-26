'use client';

import { ResetIcon } from './icons';
import { Segmented } from './ui';

/** Assemblies: Assembled / Exploded, and how far the exploded parts spread (Figma v8 · Layout card). */
export default function LayoutCard({
  layout,
  onLayout,
  onSpread,
  onReset,
}: {
  layout: { mode: 'assembled' | 'exploded'; spread: number };
  onLayout: (m: 'assembled' | 'exploded') => void;
  onSpread: (s: number) => void;
  onReset?: () => void;
}) {
  const exploded = layout.mode === 'exploded';
  return (
    <div className="flex w-[248px] flex-col gap-3 rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium">Layout</h2>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            disabled={!exploded}
            title="Back to the automatic spread (undoes moved parts)"
            className="-my-1.5 flex h-7 items-center gap-[5px] rounded-md px-1 text-[12px] text-fg-2 hover:text-accent disabled:pointer-events-none disabled:opacity-40"
          >
            <ResetIcon />
            Reset
          </button>
        )}
      </div>
      <Segmented
        label="Layout"
        value={layout.mode}
        onChange={onLayout}
        options={[
          { key: 'assembled', label: 'Assembled' },
          { key: 'exploded', label: 'Exploded' },
        ]}
        className="w-full gap-0.5 rounded-[9px] border border-border bg-bg/40 p-[3px] [--seg-pad:3px] [--seg-radius:6px]"
        thumbClass="bg-fill"
        segmentClass="flex h-8 flex-1 items-center justify-center rounded-[6px] text-[13px]"
      />
      {exploded && (
        <label className="flex items-center gap-3">
          <span className="text-[12px] text-fg-2">Spread</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(layout.spread * 100)}
            onChange={(e) => onSpread(Number(e.target.value) / 100)}
            className="h-1 flex-1 cursor-pointer accent-[var(--t-accent)]"
            aria-label="Spread"
          />
          <span className="w-9 text-right text-[12px] text-fg-3 tabular-nums">{Math.round(layout.spread * 100)}%</span>
        </label>
      )}
    </div>
  );
}
