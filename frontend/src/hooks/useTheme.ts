import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'ahorrar-theme';

/** Manual preference - only written by toggleTheme (never by the system). */
function getStoredTheme(): Theme | null {
  if (typeof window === 'undefined') return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeClass(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Crossfade leve del documento (View Transitions API).
 * flushSync: el snapshot "new" incluye el DOM ya flipped (si no, dark→light parece instant).
 */
function runThemeTransition(updateDom: () => void): void {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => unknown;
  };
  if (typeof doc.startViewTransition === 'function' && !prefersReducedMotion()) {
    doc.startViewTransition(updateDom);
    return;
  }
  updateDom();
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme() ?? getSystemTheme());

  // Sync class for mount + system-driven changes (sin animación).
  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  // Follow the OS live while no manual preference is stored.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      if (getStoredTheme() !== null) return; // manual choice wins
      setTheme(event.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    runThemeTransition(() => {
      flushSync(() => {
        applyThemeClass(next);
        localStorage.setItem(STORAGE_KEY, next);
        setTheme(next);
      });
    });
  }, [theme]);

  return { theme, toggleTheme };
}
