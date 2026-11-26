'use client';

import { useMemo } from 'react';
import { gimbalSVG } from '@/lib/gimbal';
import { AXIS_COLOR, formatAngle, rotationMatrix, type Axis, type Rot } from '@/lib/views';
import { ResetIcon, RotateIcon } from './icons';
import { Chip } from './ui';

const STEPS = [15, 30, 45, 90];
const AXES: Axis[] = ['x', 'y', 'z'];

export default function OrientationCard({
  rot,
  step,
  onRotate,
  onStep,
  onReset,
}: {
  rot: Rot;
  step: number;
  onRotate: (axis: number, delta: number) => void;
  onStep: (step: number) => void;
  onReset: () => void;
}) {
  // The cube and rings stay in the global orientation (the same axes as the move arrows on a part);
  // the rows below show how far the model is turned about each axis
  const gimbal = useMemo(() => gimbalSVG(rotationMatrix([0, 0, 0])), []);
  const isZero = rot.every((a) => a === 0);

  return (
    <div className="flex w-[248px] flex-col gap-3 rounded-xl border border-border bg-surface p-3.5">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium">Orientation</h2>
        <button
          type="button"
          onClick={onReset}
          disabled={isZero}
          className="-my-1.5 flex h-7 items-center gap-[5px] rounded-md px-1 text-[12px] text-fg-2 hover:text-accent disabled:pointer-events-none disabled:opacity-40"
        >
          <ResetIcon />
          Reset
        </button>
      </div>

      <div className="h-[190px] w-[220px] shrink-0" role="img" aria-label="Orientation gimbal" dangerouslySetInnerHTML={{ __html: gimbal }} />

      {AXES.map((axis, i) => (
        <div key={axis} className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: AXIS_COLOR[axis] }} />
          <span className="text-[12px] font-medium">{axis.toUpperCase()} axis</span>
          <span className={`flex-1 text-[12px] ${rot[i] === 0 ? 'text-fg-3' : 'text-fg'}`}>{formatAngle(rot[i])}</span>
          {([-1, 1] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => onRotate(i, dir * step)}
              aria-label={`Rotate ${dir < 0 ? '−' : '+'}${step}° about ${axis.toUpperCase()}`}
              title={`${dir < 0 ? '−' : '+'}${step}°`}
              className="flex h-7 w-[30px] items-center justify-center rounded-md bg-fill/60 hover:bg-fill-hover active:bg-fill/40"
              style={{ color: AXIS_COLOR[axis] }}
            >
              <RotateIcon dir={dir} />
            </button>
          ))}
        </div>
      ))}

      <div className="flex items-center gap-1.5">
        <span className="flex-1 text-[11px] text-fg-3">Step</span>
        {STEPS.map((s) => (
          <Chip key={s} label={`${s}°`} selected={s === step} onClick={() => onStep(s)} />
        ))}
      </div>
    </div>
  );
}
