'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';

export type Theme = 'dark' | 'light';
const KEY = 'outliner-theme';

/** Sun / moon segmented toggle. The theme lives on <html data-theme>, set before paint in layout.tsx. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  const choose = (t: Theme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem(KEY, t);
    } catch {}
  };

  const seg = (t: Theme, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={theme === t}
      aria-label={label}
      title={label}
      onClick={() => choose(t)}
      className={`flex h-[22px] w-[26px] items-center justify-center rounded-md ${
        theme === t ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.08)]' : 'text-fg-3 hover:text-fg-2'
      }`}
    >
      {icon}
    </button>
  );

  return (
    <div role="radiogroup" aria-label="Theme" className="flex shrink-0 gap-0.5 rounded-lg bg-fill p-0.5">
      {seg('light', 'Light mode', <SunIcon />)}
      {seg('dark', 'Dark mode', <MoonIcon />)}
    </div>
  );
}
