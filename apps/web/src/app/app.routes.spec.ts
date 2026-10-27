import { Route } from '@angular/router';
import { adminGuard } from './auth/admin.guard';
import { authGuard } from './auth/auth.guard';
import { routes } from './app.routes';

const shellChildren = (routes.find((r) => r.path === '' && r.children)?.children ?? []) as Route[];
const child = (path: string) => shellChildren.find((r) => r.path === path);

describe('app routes', () => {
  it('serves /audit inside the authenticated shell, for admins only', () => {
    expect(routes.find((r) => r.path === '' && r.children)?.canActivate).toContain(authGuard);
    expect(child('audit')?.canActivate).toEqual([adminGuard]);
  });

  it('does not guard /customers beyond authentication (reads are for every user)', () => {
    expect(child('customers')?.canActivate).toBeUndefined();
  });
});
