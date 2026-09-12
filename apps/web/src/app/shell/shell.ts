import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { RoleEnum } from '@repo/shared-types';
import { AUTH_CLIENT } from '../auth/auth-client.token';
import { SessionService } from '../auth/session.service';
import { ThemeService } from '../theme/theme.service';

interface NavEntry {
  label: string;
  path: string;
  icon: string;
  adminOnly: boolean;
}

interface NavGroup {
  label: string;
  entries: NavEntry[];
}

/** Groups mirror the reference admin template's sidebar ("Main" / "System" sections). */
const NAV_GROUPS: NavGroup[] = [
  { label: 'Main', entries: [{ label: 'Dashboard', path: '/dashboard', icon: 'space_dashboard', adminOnly: false }] },
  { label: 'System', entries: [{ label: 'Users', path: '/users', icon: 'group', adminOnly: true }] },
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
    MatMenuModule,
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
  protected readonly userInitials = computed(() => {
    const source = this.userName().trim();
    if (!source) return '';
    const parts = source.split(/\s+/).filter(Boolean);
    return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : source.slice(0, 2).toUpperCase();
  });
  protected readonly navGroups = computed(() => {
    const isAdmin = this.session.user()?.role === RoleEnum.ADMIN;
    return NAV_GROUPS.map((group) => ({
      label: group.label,
      entries: group.entries.filter((entry) => !entry.adminOnly || isAdmin),
    })).filter((group) => group.entries.length > 0);
  });

  protected readonly isImpersonating = this.session.isImpersonating;
  protected readonly impersonatedUserLabel = computed(() => this.session.user()?.name ?? this.session.user()?.email ?? '');

  protected async signOut(): Promise<void> {
    await this.authClient.signOut();
    await this.session.signedOut();
    await this.router.navigateByUrl('/sign-in');
  }

  protected async stopImpersonating(): Promise<void> {
    await this.authClient.admin.stopImpersonating();
    await this.router.navigateByUrl('/users');
  }
}
