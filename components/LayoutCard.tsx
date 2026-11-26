'use client';

import { ResetIcon } from './icons';
import { AXIS_COLOR } from '@/lib/views';

export type Axis = 'radial' | 'x' | 'y' | 'z';
import { Segmented } from './ui';

/** Assemblies: Assembled / Exploded, and how far the exploded parts spread (Figma v8 · Layout card). */
export default function LayoutCard({
  layout,
  onLayout,
  onSpread,
  onAxis,
  onReset,
  onEditStart,
}: {
  layout: { mode: 'assembled' | 'exploded'; spread: number; axis: Axis };
  onLayout: (m: 'assembled' | 'exploded') => void;
  onSpread: (s: number) => void;
  onAxis: (a: Axis) => void;
  onReset?: () => void;
  /** Before a change (slider grab), so Ctrl+Z can undo it. */
  onEditStart?: () => void;
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
        <div className="flex items-center gap-1.5">
          <span className="flex-1 text-[12px] text-fg-2">Direction</span>
          {(['radial', 'x', 'y', 'z'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onAxis(a)}
              aria-pressed={layout.axis === a}
              title={a === 'radial' ? 'Out from the centre in every direction' : `Along the global ${a.toUpperCase()} axis only`}
              className={`flex h-7 items-center gap-1 rounded-md border-[1.5px] px-2 text-[12px] ${
                layout.axis === a ? 'border-accent text-fg' : 'border-transparent bg-fill/60 text-fg-2 hover:text-fg'
              }`}
            >
              {a !== 'radial' && <span className="size-1.5 rounded-full" style={{ background: AXIS_COLOR[a] }} />}
              {a === 'radial' ? 'Radial' : a.toUpperCase()}
            </button>
          ))}
        </div>
      )}
      {exploded && (
        <label className="flex items-center gap-3">
          <span className="text-[12px] text-fg-2">Spread</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(layout.spread * 100)}
            onPointerDown={onEditStart}
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
