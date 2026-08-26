import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE_KEY, ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.colorScheme = '';
  });

  it('defaults to light when nothing is stored', () => {
    const service = TestBed.inject(ThemeService);

    expect(service.mode()).toBe('light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('falls back to light without error when the stored value is unreadable', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');

    expect(() => TestBed.inject(ThemeService)).not.toThrow();
    expect(TestBed.inject(ThemeService).mode()).toBe('light');
  });

  it('persists a dark preference so it survives a reload', () => {
    TestBed.inject(ThemeService).toggle();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    // Simulate a reload: a fresh root injector re-reads localStorage from scratch.
    TestBed.resetTestingModule();
    const afterReload = TestBed.inject(ThemeService);

    expect(afterReload.mode()).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('toggle flips between light and dark and persists each change', () => {
    const service = TestBed.inject(ThemeService);

    service.toggle();
    expect(service.mode()).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    service.toggle();
    expect(service.mode()).toBe('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });
});
