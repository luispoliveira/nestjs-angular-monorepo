# Corner cases — Angular

## `ngsw-worker.js` only shows a push wrapped in `notification` — and opens its URL only through `data.onActionClick`

The Angular service worker does **not** show an arbitrary Web Push payload. It shows one only when the JSON payload is `{ "notification": { title, body, icon, tag, renotify, data } }` — a flat `{ title, body }` is silently ignored (no notification, no error). A click opens nothing by default: the target has to be declared as `data.onActionClick.default = { operation: 'navigateLastFocusedOrOpen', url }`, which focuses an open tab or opens one. `PushConsumer.ngswPayload` (`apps/worker`) builds exactly this and `push.consumer.spec.ts` pins the shape; a plain `web-push` payload written by hand will "send" with a 201 and show nothing. Also: the service worker is registered only in **production** builds, so push can never be tried under `ng serve` — build with `pnpm --filter web build` and serve `dist/web/browser` (over HTTPS or `localhost`) to test on a device.

## `<mat-dialog-content class="flex …">` silently renders as `display: block`

**Symptom:** dialog form fields sit side by side in narrow inline rows (and overflow the dialog) instead of stacking, even though `<mat-dialog-content>` has `flex flex-col gap-2`.

**Cause:** Material's `.mat-mdc-dialog-content { display: block }` is injected **unlayered**, while Tailwind v4 utilities live in `@layer utilities`. Unlayered CSS beats any layered rule regardless of specificity, so `.flex` loses, and the `inline-flex` `mat-form-field`s flow inline. `flex-col`/`gap-*` still compute, but they do nothing on a block container. This affected every dialog in `apps/web`.

**Fix:** a global unlayered `.mat-mdc-dialog-content.flex { display: flex; }` in `apps/web/src/styles.scss` (specificity 0,2,0 beats Material's 0,1,0 regardless of injection order). When a Tailwind utility "does nothing" on a Material element, check the computed style for an unlayered Material rule before adding more classes.

## `apps/web` is zoneless — a plain-field mutation plus `detectChanges()` re-renders nothing

There is no `zone.js`. In a spec, `fixture.componentInstance.field = 'x'; fixture.detectChanges();` does nothing if `field` is a plain class field, and the assertion then fails against the first render with just a `null` from `querySelector`. Use a `signal()` on test hosts, or `fixture.componentRef.setInput(...)`. The same trap exists in components: a template reading `form.controls.x.value` directly does not update when the form changes programmatically (`patchValue`), only on a DOM event. Derive it into a signal: `toSignal(form.valueChanges.pipe(map(...)), { initialValue })`.

## Two `<ng-content>` in different `@if` branches: only the first ever receives the content

Projection is resolved from declaration order, not from the branch that renders, so every later `<ng-content>` is empty. Put one `<ng-content>` in a shared `<ng-template>` that both branches instantiate through `ngTemplateOutlet`.

## `@if (expr; as alias)` is not narrowed enough to index a `Record`

`LABELS[role]` with `role` from `@if (user.role; as role)` fails `check-types` ("implicitly has an 'any' type") though display and typed method calls work. Do not index from the template: call a method (`label(role: RoleEnum)`).

## `model()` already declares `xChange` — an explicit `output` of the same name is NG1054

`value = model('')` generates `valueChange`; adding `valueChange = output()` fails the build and cascades into `NG2012` on every importer. Setting the model is what emits.

## `viewChild` with an explicit generic _and_ a `read` option does not type-check

The type argument selects the overload without options. Write `viewChild('trigger', { read: ElementRef<HTMLElement> })`. `read: ElementRef` matters when the template ref sits on a component, because without it the query returns the component instance, not its host element.

## A running `ng serve` keeps serving the old `@repo/shared-types` after a schema change — restart it

`apps/web` resolves `@repo/shared-types` through its `dist/` (`package.json` → `main`), and Vite pre-bundles it once when `ng serve` starts (`apps/web/.angular/cache/<version>/…/vite/deps`). Rebuilding the package does not invalidate that pre-bundle. Symptoms: valid values fail validation or responses throw on `parse`, a screen stuck on its loading state with a `ZodError` in `query.failureReason()` (TanStack Query pauses the retry of a failed query while the tab is hidden, so it looks like a hang), or a blank screen with `The requested module '…/vite/deps/@repo_shared-types.js' does not provide an export named 'X'`. Fix: stop `ng serve`, `rm -rf apps/web/.angular/cache`, rebuild the package, restart — before debugging the "failure". Specs and `pnpm build` stay green meanwhile.

## CDK's overlay keyboard dispatcher listens on `<body>`, not `document`

A spec's `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))` never reaches an overlay; dispatch on `document.body`. `MatDialog`'s Escape does not fire from a synthetic event at all: assert through `close()` instead.

## Overriding a `--mat-sys-*` role needs source order, not higher specificity

`mat.theme()` emits into the selector it is included in (`html` in `src/styles.scss`), and `:root` and `html` tie on specificity, so the last declaration wins. Put overrides right after `@include mat.theme(...)` in the same block. Confirm with `grep -ob -- '--mat-sys-primary:' dist/web/browser/styles-*.css` (the override must have the higher offset).

## A CSS variable that was never declared fails silently, taking its whole declaration with it

`padding: var(--space-6) 0` does nothing when `--space-6` does not exist: an unresolved `var()` invalidates the entire declaration at computed-value time, with no fallback and no warning. Declare a new custom property in the same change that first reads it, or give `var()` a fallback.

## jsdom cannot compute a `border` shorthand that holds a `var()`

`[style.border]="'1px solid var(--x)'"` reads back from `getComputedStyle(el).borderWidth` as `16px` (and `border` as `16px none rgba(0, 0, 0, 0)`) under jsdom. The browser is fine. In a spec, assert the declared value (`el.style.border`) instead.

## Class names are not stable in a bundled Angular spec

The test bundler renames classes (`Account` → `_Account`). Compare by identity (`expect(resolved).toBe(Account)`), not by `component.name`.

## A spec that reads a file must resolve it from `process.cwd()`, declare `@types/node`, and run from `apps/web`

`import.meta.url` is not a `file:` URL in the bundled test environment, so `fileURLToPath(new URL(...))` throws. `resolve(process.cwd(), 'src/styles.scss')` works only when the runner starts at the app root (`pnpm --filter web test`, or `ng test --include='**/x.spec.ts'` from `apps/web`). The spec also needs `node:fs`/`node:path`/`process` types: `@types/node` is a devDependency of `apps/web` and `tsconfig.spec.json` lists `"node"` in `types`, because pnpm's strict layout does not resolve it otherwise (see `src/app/pwa.spec.ts`, `src/app/dialog-fullscreen.spec.ts`).
