import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RoleEnum } from '@repo/shared-types';
import { AUTH_CLIENT } from '../auth/auth-client.token';
import { SessionService } from '../auth/session.service';
import { ThemeService } from '../theme/theme.service';

interface NavEntry {
  label: string;
  path: string;
  adminOnly: boolean;
}

const NAV_ENTRIES: NavEntry[] = [
  { label: 'Dashboard', path: '/dashboard', adminOnly: false },
  { label: 'Users', path: '/users', adminOnly: true },
];

/**
 * The authenticated app shell — sidenav, top bar, and the router-outlet for
 * protected screens. Navigation entries are filtered by role so a non-admin
 * never even sees the admin-only entry (angular-web-app spec's "Navigation
 * reflects the session's role").
 */
@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatButtonModule,
    MatIconModule,
  ],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly session = inject(SessionService);
  private readonly authClient = inject(AUTH_CLIENT);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);

  protected readonly userName = computed(() => this.session.user()?.name ?? this.session.user()?.email ?? '');
  protected readonly navEntries = computed(() => {
    const isAdmin = this.session.user()?.role === RoleEnum.ADMIN;
    return NAV_ENTRIES.filter((entry) => !entry.adminOnly || isAdmin);
  });

  protected async signOut(): Promise<void> {
    await this.authClient.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
