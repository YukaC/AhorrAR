import { beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTheme } from './useTheme';

/** matchMedia mock with live change dispatch (OS theme can flip at runtime). */
function installMatchMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media = {
    get matches() {
      return dark;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, cb: (event: { matches: boolean }) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (event: { matches: boolean }) => void) => {
      listeners.delete(cb);
    },
    dispatchEvent: () => false,
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (_query: string) => media,
  });
  return {
    setDark(next: boolean) {
      dark = next;
      for (const cb of listeners) cb({ matches: next });
    },
  };
}

function installStorage() {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
}

describe('useTheme', () => {
  beforeEach(() => {
    installStorage();
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('follows system preference on first load', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('does not persist the system-derived theme (only manual toggles persist)', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('ahorrar-theme')).toBeNull();
  });

  it('follows live system changes while no manual preference is stored', () => {
    const system = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    act(() => system.setDark(true));
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('ahorrar-theme')).toBeNull();
  });

  it('toggles and persists the choice', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('ahorrar-theme')).toBe('dark');

    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('ahorrar-theme')).toBe('light');
  });

  it('respects a stored preference over the system', () => {
    localStorage.setItem('ahorrar-theme', 'light');
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('ignores system changes once a manual preference is stored', () => {
    const system = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggleTheme()); // manual → dark, persisted
    expect(localStorage.getItem('ahorrar-theme')).toBe('dark');
    act(() => system.setDark(false)); // OS change → ignored
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});