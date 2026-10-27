import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { Customer } from '@repo/shared-types';
import { CustomersApi } from '../customers.api';
import { CustomerFormDialog } from './customer-form-dialog';

const existing: Customer = {
  id: 'c1',
  name: 'Ana Silva',
  email: 'ana@example.com',
  taxId: '123456789',
  notes: null,
  createdAt: new Date('2026-10-10T10:00:00.000Z'),
  updatedAt: new Date('2026-10-10T10:00:00.000Z'),
};

function setUp(data: Customer | null, api: Partial<Record<keyof CustomersApi, ReturnType<typeof vi.fn>>>) {
  const close = vi.fn();
  const snackOpen = vi.fn();
  TestBed.configureTestingModule({
    imports: [MatDialogModule],
    providers: [
      provideTanStackQuery(new QueryClient()),
      { provide: CustomersApi, useValue: api },
      { provide: MatDialogRef, useValue: { close } },
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatSnackBar, useValue: { open: snackOpen } },
    ],
  });
  const fixture = TestBed.createComponent(CustomerFormDialog);
  fixture.detectChanges();
  return { fixture, instance: fixture.componentInstance, close, snackOpen };
}

describe('CustomerFormDialog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows a NIF field error and blocks submission for an invalid NIF', async () => {
    const create = vi.fn();
    const { fixture, instance } = setUp(null, { create });

    instance['form'].setValue({ name: 'Ana', email: '', taxId: '123456788', notes: '' });
    await instance['onSubmit']();
    fixture.detectChanges();

    expect(create).not.toHaveBeenCalled();
    expect(instance['form'].controls.taxId.errors?.['zod']).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="taxid-error"]')).toBeTruthy();
  });

  it('accepts blank optional fields and sends the parsed payload on create', async () => {
    const create = vi.fn().mockResolvedValue(existing);
    const { instance, close } = setUp(null, { create });
    const invalidate = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');

    instance['form'].setValue({ name: ' Ana Silva ', email: '', taxId: 'PT 123 456 789', notes: '' });
    await instance['onSubmit']();

    expect(create).toHaveBeenCalledWith({ name: 'Ana Silva', taxId: '123456789' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['customers'] });
    expect(close).toHaveBeenCalledWith(true);
  });

  it('keeps the dialog open with a conflict error on taxId when the API answers 409', async () => {
    const create = vi.fn().mockRejectedValue(new HttpErrorResponse({ status: 409, statusText: 'Conflict' }));
    const { fixture, instance, close } = setUp(null, { create });

    instance['form'].setValue({ name: 'Ana', email: '', taxId: '123456789', notes: '' });
    await instance['onSubmit']();
    fixture.detectChanges();

    expect(close).not.toHaveBeenCalled();
    expect(instance['form'].controls.taxId.errors?.['conflict']).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="taxid-error"]')?.textContent).toContain('already in use');
  });

  it('reports any other failure in a snackbar and keeps the dialog open', async () => {
    const create = vi.fn().mockRejectedValue(new HttpErrorResponse({ status: 500, statusText: 'Server Error' }));
    const { instance, close, snackOpen } = setUp(null, { create });

    instance['form'].setValue({ name: 'Ana', email: '', taxId: '', notes: '' });
    await instance['onSubmit']();

    expect(close).not.toHaveBeenCalled();
    expect(snackOpen).toHaveBeenCalled();
    expect(instance['form'].controls.taxId.errors).toBeNull();
  });

  it('pre-fills the form in edit mode and sends only the changed fields', async () => {
    const update = vi.fn().mockResolvedValue({ ...existing, name: 'Ana Maria', email: null });
    const { instance, close } = setUp(existing, { update });

    expect(instance['form'].getRawValue()).toEqual({
      name: 'Ana Silva',
      email: 'ana@example.com',
      taxId: '123456789',
      notes: '',
    });

    instance['form'].patchValue({ name: 'Ana Maria', email: '' });
    await instance['onSubmit']();

    expect(update).toHaveBeenCalledWith('c1', { name: 'Ana Maria', email: null });
    expect(close).toHaveBeenCalledWith(true);
  });

  it('closes without a request when nothing changed in edit mode', async () => {
    const update = vi.fn();
    const { instance, close } = setUp(existing, { update });

    await instance['onSubmit']();

    expect(update).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(false);
  });
});
