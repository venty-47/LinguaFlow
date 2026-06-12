'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark' | 'green' | 'ocean' | 'sunset' | 'system';
export type ResolvedTheme = 'light' | 'dark' | 'green' | 'ocean' | 'sunset';

const THEMES: Theme[] = ['light', 'dark', 'green', 'ocean', 'sunset', 'system'];
const STORAGE_KEY = 'linguaflow-theme';

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(v: string | null): v is Theme {
  return !!v && (THEMES as string[]).includes(v);
}

function isDarkish(t: ResolvedTheme): boolean {
  return t === 'dark' || t === 'ocean';
}

function resolve(theme: Theme, system: ResolvedTheme): ResolvedTheme {
  if (theme === 'system') {
    return system === 'dark' ? 'dark' : 'light';
  }
  return theme;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', isDarkish(resolved));
  root.dataset.theme = resolved;
  root.style.colorScheme = isDarkish(resolved) ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system');
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>('dark');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const initialTheme: Theme = isTheme(saved) ? saved : 'system';
    const initialSystem = getSystemTheme();
    setThemeState(initialTheme);
    setSystemTheme(initialSystem);
    applyTheme(resolve(initialTheme, initialSystem));

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemTheme(getSystemTheme());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    applyTheme(resolve(theme, systemTheme));
  }, [theme, systemTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      window.localStorage.setItem(STORAGE_KEY, next);
      applyTheme(resolve(next, systemTheme));
    },
    [systemTheme]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme: resolve(theme, systemTheme), setTheme }),
    [theme, systemTheme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
