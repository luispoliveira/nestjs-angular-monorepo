import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Specs run with apps/web as the working directory (see CORNER_CASES.md).
const styles = readFileSync(resolve(process.cwd(), 'src/styles.scss'), 'utf8');

/** The body of the first `@media` block whose query matches, with balanced braces. */
function mediaBlock(source: string, query: RegExp): string | null {
  const start = source.search(query);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  return null;
}

// jsdom does not evaluate SCSS or media queries, so this pins the contract of
// the stylesheet; the rendered result is checked in a real browser (design D9).
describe('full-screen dialogs on a narrow viewport', () => {
  const narrow = mediaBlock(styles, /@media[^{]*max-width:\s*767(\.98)?px[^{]*/);

  it('declares a rule for the narrow viewport (below the 768px mobile breakpoint)', () => {
    expect(narrow).not.toBeNull();
  });

  it('makes the dialog panel fill the viewport, overriding the inline width a caller passes to MatDialog.open', () => {
    expect(narrow).toContain('.mat-mdc-dialog-panel');
    for (const declaration of ['width: 100vw !important', 'max-width: 100vw !important', 'height: 100dvh !important', 'max-height: 100dvh !important']) {
      expect(narrow).toContain(declaration);
    }
  });

  it('lets the dialog content grow instead of capping it at the default 65vh', () => {
    expect(narrow).toMatch(/\.mat-mdc-dialog-content[^}]*max-height:\s*none/);
  });

  it('leaves desktop dialogs alone: nothing sizes a dialog panel outside the media query', () => {
    const outside = styles.replace(narrow ?? '', '');
    expect(outside).not.toContain('100vw');
    expect(outside).not.toContain('100dvh');
  });
});
