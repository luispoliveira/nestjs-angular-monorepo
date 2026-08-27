import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import type { ZodType } from 'zod';

/**
 * Adapts a Zod schema into an Angular `ValidatorFn`, so the same schema
 * drives both backend DTOs (`createZodDto`) and frontend form validation
 * (design.md → D6). Intended for a `FormGroup` whose raw value matches the
 * schema's shape: each Zod issue is set on the matching child control (by
 * path) so the field reports its own error, alongside a combined `zod`
 * error on the group itself. Falls back to a single group-level error when
 * used on a plain control with no children.
 *
 * Uses only `@angular/forms` types (erased at compile time) — no runtime
 * import — so this stays inert for non-Angular consumers of this package.
 */
export function zodValidator(schema: ZodType): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const children = getChildControls(control);
    const result = schema.safeParse(control.value);

    if (result.success) {
      clearOwnErrors(children);
      return null;
    }

    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      fieldErrors[path] ??= issue.message;

      const child = children?.[path];
      if (child && child.errors?.['zod'] !== issue.message) {
        child.setErrors({ ...child.errors, zod: issue.message });
      }
    }

    return { zod: fieldErrors };
  };
}

function getChildControls(
  control: AbstractControl,
): Record<string, AbstractControl> | undefined {
  const controls = (control as { controls?: unknown }).controls;
  return controls && typeof controls === 'object'
    ? (controls as Record<string, AbstractControl>)
    : undefined;
}

function clearOwnErrors(children: Record<string, AbstractControl> | undefined): void {
  if (!children) return;
  for (const child of Object.values(children)) {
    if (child.errors?.['zod'] === undefined) continue;
    const { zod: _zod, ...rest } = child.errors;
    child.setErrors(Object.keys(rest).length > 0 ? rest : null);
  }
}
