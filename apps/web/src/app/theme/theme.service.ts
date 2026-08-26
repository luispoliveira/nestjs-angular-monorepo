import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

// Keep in sync with the inline pre-bootstrap script in src/index.html.
export const THEME_STORAGE_KEY = 'theme-mode';

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function apply(mode: ThemeMode): void {
  document.documentElement.style.colorScheme = mode;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // storage unavailable (private browsing, quota) — in-memory mode still applies
  }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<ThemeMode>(readStoredMode());

  constructor() {
    apply(this.mode());
  }

  toggle(): void {
    const next = this.mode() === 'dark' ? 'light' : 'dark';
    this.mode.set(next);
    apply(next);
  }
}
