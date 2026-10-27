import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { QueryClient } from '@tanstack/angular-query-experimental';
import { createCustomerSchema, Customer, updateCustomerSchema, zodValidator } from '@repo/shared-types';
import { z } from 'zod';
import { CustomersApi } from '../customers.api';

interface FormValue {
  name: string;
  email: string;
  taxId: string;
  notes: string;
}
const OPTIONAL_FIELDS = ['email', 'taxId', 'notes'] as const;

/**
 * A blank form field means "absent": `undefined` on create, `null` (clear) on
 * edit. Wrapping the shared schemas keeps them the single source of truth —
 * issue paths are unchanged, so zodValidator still reports per field.
 */
function blanksAs(blank: undefined | null) {
  return (value: unknown) => {
    const v = { ...(value as FormValue) } as Record<string, unknown>;
    for (const key of OPTIONAL_FIELDS) if (v[key] === '') v[key] = blank;
    return v;
  };
}
const createFormSchema = z.preprocess(blanksAs(undefined), createCustomerSchema);
const editFormSchema = z.preprocess(blanksAs(null), updateCustomerSchema);

/** One dialog for create (`data: null`) and edit (`data: Customer`). */
@Component({
  selector: 'app-customer-form-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './customer-form-dialog.html',
})
export class CustomerFormDialog {
  private readonly api = inject(CustomersApi);
  private readonly dialogRef = inject(MatDialogRef<CustomerFormDialog>);
  private readonly queryClient = inject(QueryClient);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly customer = inject<Customer | null>(MAT_DIALOG_DATA);

  private readonly initial: FormValue = {
    name: this.customer?.name ?? '',
    email: this.customer?.email ?? '',
    taxId: this.customer?.taxId ?? '',
    notes: this.customer?.notes ?? '',
  };

  protected readonly form = inject(FormBuilder).nonNullable.group(
    { name: [this.initial.name], email: [this.initial.email], taxId: [this.initial.taxId], notes: [this.initial.notes] },
    { validators: zodValidator(this.customer ? editFormSchema : createFormSchema) },
  );

  protected readonly saving = signal(false);

  protected async onSubmit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const changed = (Object.keys(value) as (keyof FormValue)[]).filter((k) => value[k] !== this.initial[k]);
    if (this.customer && changed.length === 0) {
      this.dialogRef.close(false);
      return;
    }

    this.saving.set(true);
    try {
      if (this.customer) {
        const parsed = editFormSchema.parse(value);
        const patch = Object.fromEntries(changed.map((k) => [k, parsed[k]]));
        await this.api.update(this.customer.id, patch);
      } else {
        await this.api.create(createFormSchema.parse(value));
      }
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.form.controls.taxId.setErrors({ conflict: 'NIF already in use' });
        this.form.controls.taxId.markAsTouched();
      } else {
        this.snackBar.open('Failed to save customer.', 'Dismiss', { duration: 5000 });
      }
      return;
    } finally {
      this.saving.set(false);
    }

    await this.queryClient.invalidateQueries({ queryKey: ['customers'] });
    this.snackBar.open(this.customer ? 'Customer updated' : 'Customer created', 'Dismiss', { duration: 5000 });
    this.dialogRef.close(true);
  }

  protected close(): void {
    this.dialogRef.close(false);
  }
}
