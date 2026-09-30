import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('main.ts', () => {
  it('should import ./instrument before anything else so Sentry can trace every module', () => {
    const source = readFileSync(join(__dirname, 'main.ts'), 'utf8');
    const firstImport = source.match(/^import\s.*$/m)?.[0];
    expect(firstImport).toBe("import './instrument';");
  });
});
