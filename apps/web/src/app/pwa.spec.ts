import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { appConfig } from './app.config';

// Specs run with apps/web as the working directory (see CORNER_CASES.md).
const fromRoot = (path: string) => resolve(process.cwd(), path);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(fromRoot(path), 'utf8')) as T;

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}
interface Manifest {
  name: string;
  short_name: string;
  display: string;
  start_url: string;
  icons: ManifestIcon[];
}
interface NgswConfig {
  index: string;
  assetGroups: { name: string }[];
  dataGroups?: unknown[];
  navigationUrls?: string[];
}

describe('PWA install support', () => {
  describe('service worker registration', () => {
    it('is not registered in a development build', () => {
      TestBed.configureTestingModule({ providers: appConfig.providers });
      expect(TestBed.inject(SwUpdate).isEnabled).toBe(false);
    });

    it('is switched on for the production build in angular.json', () => {
      const angular = readJson<{
        projects: {
          web: { architect: { build: { configurations: { production: { serviceWorker?: string } } } } };
        };
      }>('angular.json');
      expect(angular.projects.web.architect.build.configurations.production.serviceWorker).toBe(
        'ngsw-config.json',
      );
    });
  });

  describe('ngsw-config.json', () => {
    const config = readJson<NgswConfig>('ngsw-config.json');

    it('caches the app shell and the icons', () => {
      const names = config.assetGroups.map((group) => group.name);
      expect(names).toEqual(expect.arrayContaining(['app', 'assets']));
    });

    it('never caches API data: it declares no dataGroups', () => {
      expect(config.dataGroups ?? []).toEqual([]);
    });

    it('lets a navigation to /api/** reach the server instead of receiving index.html', () => {
      expect(config.navigationUrls).toContain('!/api/**');
    });
  });

  describe('manifest', () => {
    const manifest = readJson<Manifest>('public/manifest.webmanifest');

    it('declares a name, a standalone display mode and a start URL', () => {
      expect(manifest.name).toBeTruthy();
      expect(manifest.short_name).toBeTruthy();
      expect(manifest.display).toBe('standalone');
      expect(manifest.start_url).toBeTruthy();
    });

    it('declares 192 and 512 icons, each also in a maskable variant', () => {
      for (const size of ['192x192', '512x512']) {
        const sized = manifest.icons.filter((icon) => icon.sizes === size);
        expect(sized.some((icon) => (icon.purpose ?? 'any') === 'any')).toBe(true);
        expect(sized.some((icon) => icon.purpose === 'maskable')).toBe(true);
      }
    });

    it('serves every icon from the single icons directory, and each file exists', () => {
      for (const icon of manifest.icons) {
        expect(icon.src.startsWith('icons/')).toBe(true);
        expect(existsSync(fromRoot(`public/${icon.src}`))).toBe(true);
      }
    });
  });

  describe('index.html', () => {
    const html = readFileSync(fromRoot('src/index.html'), 'utf8');

    it('links the manifest and a theme colour', () => {
      expect(html).toMatch(/<link[^>]+rel="manifest"[^>]+href="manifest\.webmanifest"/);
      expect(html).toMatch(/<meta[^>]+name="theme-color"/);
    });

    it('takes every favicon from the icons directory', () => {
      const icons = [...html.matchAll(/<link[^>]+rel="icon"[^>]*href="([^"]+)"/g)].map((m) => m[1]!);
      expect(icons.length).toBeGreaterThan(0);
      for (const href of icons) {
        expect(href.startsWith('icons/')).toBe(true);
        expect(existsSync(fromRoot(`public/${href}`))).toBe(true);
      }
    });
  });
});
