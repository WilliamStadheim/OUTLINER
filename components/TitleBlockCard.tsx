'use client';

import { useEffect, useState } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TitleField } from '@/lib/sheet';
import { MAX_CELLS, defaultFields } from '@/lib/titleblock';
import { Check } from './icons';
import { LinkButton } from './ui';

function Handle(props: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label="Drag to reorder" className="flex h-6 w-3 shrink-0 cursor-grab items-center justify-center text-fg-3 hover:text-fg-2 active:cursor-grabbing" {...props}>
      <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor" aria-hidden>
        {[2, 6].map((x) => [2, 6, 10].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1" />))}
      </svg>
    </button>
  );
}

function Box({ on, disabled, onToggle, label }: { on: boolean; disabled?: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      title={disabled ? `The table holds ${MAX_CELLS} fields` : undefined}
      onClick={onToggle}
      className={`relative size-3.5 shrink-0 rounded-[4px] border-[1.2px] disabled:opacity-40 ${on ? 'border-fg bg-fg text-bg' : 'border-fg-3 hover:border-fg-2'}`}
    >
      {on && <Check className="absolute -top-[1.2px] -left-[1.2px]" />}
    </button>
  );
}

function FieldRow({
  f,
  canEnable,
  autoValue,
  placeholder,
  focused,
  sortable = true,
  onChange,
  onRemove,
  onFocus,
  onBlur,
}: {
  f: TitleField;
  canEnable: boolean;
  autoValue?: string;
  placeholder?: string;
  focused: boolean;
  sortable?: boolean;
  onChange: (patch: Partial<TitleField>) => void;
  onRemove?: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const s = useSortable({ id: f.id, disabled: !sortable });
  const style = { transform: CSS.Translate.toString(s.transform), transition: s.transition };
  const off = !f.enabled;
  return (
    <div
      ref={s.setNodeRef}
      style={style}
      className={`relative flex h-[30px] w-full items-center gap-1.5 rounded-lg pr-1.5 ${
        s.isDragging ? 'z-10 border border-accent bg-surface shadow-[0_4px_12px_rgb(0_0_0/0.14)]' : ''
      }`}
    >
      {sortable ? <Handle {...s.attributes} {...s.listeners} /> : <span className="w-3 shrink-0" />}
      <Box on={f.enabled} disabled={off && !canEnable} onToggle={() => onChange({ enabled: !f.enabled })} label={`Show ${f.label}`} />
      {f.custom ? (
        <input
          value={f.label}
          onChange={(e) => onChange({ label: e.target.value })}
          aria-label="Field name"
          className={`w-16 shrink-0 bg-transparent text-[12px] font-medium text-fg outline-none ${off ? 'opacity-45' : ''}`}
        />
      ) : (
        <span className={`w-16 shrink-0 text-[12px] text-fg-2 ${off ? 'opacity-45' : ''}`}>{f.label}</span>
      )}
      {f.auto ? (
        <span className={`flex h-6 min-w-0 flex-1 items-center gap-1 px-2 text-fg-3 ${off ? 'opacity-45' : ''}`}>
          <span className="text-[12px]">{autoValue}</span>
          <span className="text-[10px]">auto</span>
        </span>
      ) : (
        <input
          id={`tb-${f.id}`}
          value={f.value}
          placeholder={placeholder}
          onChange={(e) => onChange({ value: e.target.value })}
          onFocus={onFocus}
          onBlur={onBlur}
          className={`h-6 min-w-0 flex-1 rounded-md border bg-bg px-2 text-[12px] text-fg outline-none placeholder:text-fg-3 ${
            focused ? 'border-accent' : 'border-border'
          } ${off ? 'opacity-45' : ''}`}
        />
      )}
      {f.custom && onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${f.label}`} className="flex size-5 shrink-0 items-center justify-center rounded text-fg-3 hover:text-accent">
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default function TitleBlockCard({
  fields,
  onFields,
  titlePlaceholder,
  autoValues,
  focused,
  onFocusField,
  onApplyAll,
}: {
  fields: TitleField[];
  onFields: (f: TitleField[]) => void;
  titlePlaceholder: string;
  autoValues: Record<'scale' | 'format' | 'unit', string>;
  focused: string | null;
  onFocusField: (id: string | null) => void;
  /** Assemblies: make this sheet's title block the one every sheet uses (titles stay per sheet). */
  onApplyAll?: () => void;
}) {
  const [applied, setApplied] = useState(false);
  useEffect(() => {
    if (!applied) return;
    const t = setTimeout(() => setApplied(false), 1600);
    return () => clearTimeout(t);
  }, [applied]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const title = fields.find((f) => f.id === 'title')!;
  const rest = fields.filter((f) => f.id !== 'title');
  const enabledCount = rest.filter((f) => f.enabled).length;

  const patch = (id: string, p: Partial<TitleField>) => onFields(fields.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = rest.findIndex((f) => f.id === e.active.id), to = rest.findIndex((f) => f.id === e.over!.id);
    onFields([title, ...arrayMove(rest, from, to)]);
  };
  const addField = () => {
    const id = `custom-${Date.now().toString(36)}`;
    onFields([...fields, { id, label: 'Field', value: '', enabled: enabledCount < MAX_CELLS, custom: true }]);
    requestAnimationFrame(() => document.getElementById(`tb-${id}`)?.focus());
  };

  const row = (f: TitleField, sortable = true) => (
    <FieldRow
      key={f.id}
      f={f}
      sortable={sortable}
      canEnable={enabledCount < MAX_CELLS || f.id === 'title'}
      autoValue={f.auto ? autoValues[f.auto] : undefined}
      placeholder={f.id === 'title' ? titlePlaceholder : '—'}
      focused={focused === f.id}
      onChange={(p) => patch(f.id, p)}
      onRemove={f.custom ? () => onFields(fields.filter((x) => x.id !== f.id)) : undefined}
      onFocus={() => onFocusField(f.id)}
      onBlur={() => onFocusField(null)}
    />
  );

  return (
    <section className="flex w-full shrink-0 flex-col gap-1.5 rounded-[10px] border border-border bg-surface px-3 py-3.5">
      <div className="flex items-center gap-2 px-1 pb-1">
        <h2 className="flex-1 text-[13px] font-medium">Title block</h2>
        {onApplyAll && (
          <LinkButton
            onClick={() => {
              onApplyAll();
              setApplied(true);
            }}
            title="Use these fields, their order and values on every sheet (each keeps its own title)"
          >
            {applied ? 'Applied' : 'Apply to all sheets'}
          </LinkButton>
        )}
        <LinkButton onClick={() => onFields(defaultFields())}>Reset</LinkButton>
      </div>
      <div className="flex flex-col gap-1">
        {row(title, false)}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rest.map((f) => f.id)} strategy={verticalListSortingStrategy}>
            {rest.map((f) => row(f))}
          </SortableContext>
        </DndContext>
      </div>
      <button
        type="button"
        onClick={addField}
        className="flex h-7 w-full items-center justify-center rounded-md border border-dashed border-border text-[12px] text-fg-2 hover:border-fg-3 hover:text-accent"
      >
        + Add field
      </button>
    </section>
  );
}
