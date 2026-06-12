'use client';

import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Leaf, Waves, Sunset, Monitor } from 'lucide-react';
import { useTheme, type Theme, type ResolvedTheme } from './ThemeProvider';

interface Option {
  value: Theme;
  label: string;
  icon: typeof Sun;
  swatch: string;
}

const OPTIONS: Option[] = [
  { value: 'light',  label: '浅色',     icon: Sun,    swatch: '#f7f7f4' },
  { value: 'dark',   label: '深色',     icon: Moon,   swatch: '#0f0f0f' },
  { value: 'green',  label: '护眼绿',   icon: Leaf,   swatch: '#4d8a3c' },
  { value: 'ocean',  label: '深海蓝',   icon: Waves,  swatch: '#0b1624' },
  { value: 'sunset', label: '暖阳橙',   icon: Sunset, swatch: '#d97706' },
  { value: 'system', label: '跟随系统', icon: Monitor, swatch: 'linear-gradient(90deg,#f7f7f4 50%,#0f0f0f 50%)' },
];

function currentIcon(resolved: ResolvedTheme, theme: Theme) {
  if (theme === 'system') return Monitor;
  const map: Record<ResolvedTheme, typeof Sun> = {
    light: Sun, dark: Moon, green: Leaf, ocean: Waves, sunset: Sunset,
  };
  return map[resolved];
}

export default function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const Icon = currentIcon(resolvedTheme, theme);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="切换主题"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--foreground)',
        }}
      >
        <Icon className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border shadow-lg"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          {OPTIONS.map((opt) => {
            const OptIcon = opt.icon;
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="menuitem"
                onClick={() => {
                  setTheme(opt.value);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:opacity-80"
                style={{
                  color: 'var(--foreground)',
                  backgroundColor: active ? 'var(--surface-muted)' : 'transparent',
                }}
              >
                <span
                  aria-hidden
                  className="h-4 w-4 flex-none rounded-full border"
                  style={{
                    background: opt.swatch,
                    borderColor: 'var(--border)',
                  }}
                />
                <OptIcon className="h-4 w-4 flex-none" style={{ color: 'var(--muted)' }} />
                <span className="flex-1">{opt.label}</span>
                {active && <span style={{ color: 'var(--accent)' }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
