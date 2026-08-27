import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const packageRoot = join(__dirname, '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require(join(packageRoot, 'package.json')) as {
  main: string;
  exports: Record<string, { types: string; import: string; default: string }>;
};

function declaredEntryPoints(): string[] {
  const paths = new Set<string>([pkg.main]);
  for (const condition of Object.values(pkg.exports)) {
    paths.add(condition.import);
    paths.add(condition.default);
  }
  return [...paths];
}

describe('package entry points', () => {
  it.each(declaredEntryPoints())('%s exists on disk', (entryPoint) => {
    expect(existsSync(join(packageRoot, entryPoint))).toBe(true);
  });

  it.each(declaredEntryPoints())('%s imports without throwing', async (entryPoint) => {
    const fileUrl = pathToFileURL(join(packageRoot, entryPoint)).href;
    await expect(import(fileUrl)).resolves.toBeDefined();
  });

  it('fails when an entry point is pointed at a missing path', () => {
    expect(existsSync(join(packageRoot, './dist/does-not-exist.js'))).toBe(false);
  });
});
