'use client';

import { useEffect, useRef } from 'react';
import { Check } from './icons';

/** File / Parts / Views card. */
export function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex w-full shrink-0 flex-col gap-1.5 rounded-[10px] border border-border bg-surface px-3 py-3.5">
      <div className="flex items-center gap-2 px-1 pb-1">
        <h2 className="flex-1 text-[13px] font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Small text action in a card header ("Replace", "Select all"). */
export function LinkButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="-my-1.5 flex h-7 items-center rounded-md px-1 text-[12px] text-fg-2 hover:text-accent disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function CheckboxRow({
  label,
  meta,
  checked,
  disabled,
  onChange,
  title,
}: {
  label: string;
  meta?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}) {
  return (
    <label
      title={title}
      className={`flex h-8 w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-md px-2 py-[7px] hover:bg-fill/40 has-focus-visible:outline-2 has-focus-visible:outline-fg-2 ${
        disabled ? 'pointer-events-none opacity-40' : ''
      }`}
    >
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span
        className={`relative size-3.5 shrink-0 rounded-[3px] border-[1.2px] ${checked ? 'border-fg bg-fg text-bg' : 'border-fg-3'}`}
        aria-hidden
      >
        {checked && <Check className="absolute -top-[1.2px] -left-[1.2px]" />}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[13px] ${checked ? 'text-fg' : 'text-fg-2'}`}>{label}</span>
      {meta && <span className="shrink-0 text-[11px] text-fg-3">{meta}</span>}
    </label>
  );
}

export function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex h-7 items-center justify-center rounded-md px-2.5 text-[12px] font-medium ${
        selected ? 'bg-fg text-bg' : 'bg-fill/60 text-fg-2 hover:bg-fill hover:text-fg'
      }`}
    >
      {label}
    </button>
  );
}

export type MenuItemDef = { key: string; label: string; meta?: string; disabled?: boolean; title?: string; divider?: boolean };

/** Popup menu. Closes on outside click and Escape. */
export function Menu({
  items,
  active,
  onSelect,
  onClose,
  className = '',
  header,
  style,
}: {
  items: MenuItemDef[];
  header?: string;
  style?: React.CSSProperties;
  active?: string;
  onSelect: (key: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    // let the click that opened the menu finish first
    const t = setTimeout(() => window.addEventListener('pointerdown', down));
    window.addEventListener('keydown', key);
    ref.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"], button:not(:disabled)')?.focus();
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      onKeyDown={move}
      style={style}
      onContextMenu={(e) => e.preventDefault()}
      className={`absolute z-30 flex flex-col gap-0.5 rounded-[10px] border border-border bg-surface p-1.5 shadow-menu ${className}`}
    >
      {header && <p className="max-w-[180px] truncate px-1 pt-0.5 pb-1 text-[11px] text-fg-3">{header}</p>}
      {items.map((it) =>
        it.divider ? (
          <div key={it.key} className="my-0.5 h-px w-[180px] bg-border" role="separator" />
        ) : (
        <button
          key={it.key}
          type="button"
          role="menuitemradio"
          aria-checked={it.key === active}
          disabled={it.disabled}
          title={it.title}
          onClick={() => onSelect(it.key)}
          className={`flex h-[30px] w-[180px] items-center gap-2.5 rounded-[5px] px-2.5 text-left text-[13px] hover:bg-fill focus-visible:bg-fill focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 ${
            it.key === active ? 'bg-fill' : ''
          }`}
        >
          <span className="flex-1">{it.label}</span>
          {it.meta && <span className="text-[11px] text-fg-3">{it.meta}</span>}
        </button>
        ),
      )}
    </div>
  );
}
