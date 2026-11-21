'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './icons';
import { Segmented } from './ui';

export type Theme = 'dark' | 'light';
const KEY = 'outliner-theme';

/**
 * Sun / moon toggle. The theme lives on <html data-theme>, set before paint in layout.tsx.
 * The switch cross-fades the whole page (View Transitions) so everything changes in one smooth step
 * instead of some elements easing and others snapping.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  const choose = (t: Theme) => {
    if (t === theme) return;
    setTheme(t);
    try {
      localStorage.setItem(KEY, t);
    } catch {}
    const apply = () => {
      document.documentElement.dataset.theme = t;
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (doc.startViewTransition && !reduce) doc.startViewTransition(apply);
    else apply();
  };

  return (
    <Segmented
      label="Theme"
      value={theme}
      onChange={choose}
      options={[
        { key: 'light', label: <SunIcon />, aria: 'Light mode' },
        { key: 'dark', label: <MoonIcon />, aria: 'Dark mode' },
      ]}
      className="shrink-0 gap-0.5 rounded-lg bg-fill p-0.5 [--seg-pad:2px] [--seg-radius:6px]"
      segmentClass="flex h-[22px] w-[26px] items-center justify-center rounded-md"
    />
  );
}
