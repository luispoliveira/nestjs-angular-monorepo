import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { QueryClient, provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { RoleEnum } from '@repo/shared-types';
import { AUTH_CLIENT } from '../../../auth/auth-client.token';
import { CreateUserDialog } from './create-user-dialog';

async function waitForSettled(fixture: ComponentFixture<CreateUserDialog>): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    fixture.detectChanges();
    if (!fixture.componentInstance['createUser'].isPending()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Mutation did not settle in time');
}

function setUp(createUser: (args: unknown) => Promise<unknown>) {
  const dialogRefClose = vi.fn();
  TestBed.configureTestingModule({
    imports: [MatDialogModule],
    providers: [
      provideTanStackQuery(new QueryClient()),
      { provide: AUTH_CLIENT, useValue: { admin: { createUser } } },
      { provide: MatDialogRef, useValue: { close: dialogRefClose } },
    ],
  });
  const fixture = TestBed.createComponent(CreateUserDialog);
  fixture.detectChanges();
  return { fixture, dialogRefClose };
}

describe('CreateUserDialog', () => {
  it('blocks submission on a malformed email without calling the API', async () => {
    const createUser = vi.fn();
    const { fixture } = setUp(createUser);
    const instance = fixture.componentInstance;

    instance['form'].setValue({ name: 'Jane Doe', email: 'not-an-email', role: RoleEnum.USER });
    await instance['onSubmit']();
    fixture.detectChanges();

    expect(createUser).not.toHaveBeenCalled();
    expect(instance['form'].controls.email.errors?.['zod']).toBeTruthy();
  });

  it('blocks submission when the name field is left empty', async () => {
    const createUser = vi.fn();
    const { fixture } = setUp(createUser);
    const instance = fixture.componentInstance;

    instance['form'].setValue({ name: '', email: 'jane@example.com', role: RoleEnum.USER });
    await instance['onSubmit']();
    fixture.detectChanges();

    expect(createUser).not.toHaveBeenCalled();
    expect(instance['form'].controls.name.errors?.['zod']).toBeTruthy();
  });

  it('creates the user, reveals the generated password and refreshes the list on a valid submission', async () => {
    const createUser = vi.fn().mockResolvedValue({ error: null });
    const { fixture } = setUp(createUser);
    const instance = fixture.componentInstance;
    const invalidateSpy = vi.spyOn(TestBed.inject(QueryClient), 'invalidateQueries');

    instance['form'].setValue({ name: 'Jane Doe', email: 'jane@example.com', role: RoleEnum.USER });
    await instance['onSubmit']();
    await waitForSettled(fixture);

    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Jane Doe', email: 'jane@example.com', role: RoleEnum.USER }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
    expect(instance['generatedPassword']()).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="generated-password"]')?.textContent?.trim()).toBe(
      instance['generatedPassword'](),
    );
  });

  it('shows a server error and does not reveal a password when creation fails', async () => {
    const createUser = vi.fn().mockResolvedValue({ error: { message: 'Email already in use' } });
    const { fixture } = setUp(createUser);
    const instance = fixture.componentInstance;

    instance['form'].setValue({ name: 'Jane Doe', email: 'jane@example.com', role: RoleEnum.USER });
    await instance['onSubmit']();
    await waitForSettled(fixture);

    expect(instance['generatedPassword']()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="server-error"]')?.textContent?.trim()).toBe(
      'Email already in use',
    );
  });
});
