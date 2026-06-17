import type { PageId } from '../types/app';

const PATH_TO_PAGE: Record<string, PageId> = {
  '/admin/billing': 'admin-billing',
  '/subscription': 'subscription',
  '/login': 'login',
  '/register-office': 'register-office',
  '/register-lawyer': 'register-lawyer'
};

const PAGE_TO_PATH: Partial<Record<PageId, string>> = {
  'admin-billing': '/admin/billing',
  subscription: '/subscription',
  login: '/login',
  'register-office': '/register-office',
  'register-lawyer': '/register-lawyer'
};

export function resolvePageFromLocation(): { page: PageId | null } {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  if (PATH_TO_PAGE[path]) return { page: PATH_TO_PAGE[path]! };
  if (path.startsWith('/invite/')) return { page: 'invite' };

  const params = new URLSearchParams(window.location.search);
  const queryPage = params.get('page') as PageId | null;
  if (queryPage === 'invite' || queryPage === 'accept-invite') return { page: queryPage };

  return { page: null };
}

export function syncLocationForPage(page: PageId): void {
  const path = PAGE_TO_PATH[page];
  if (path && window.location.pathname !== path) {
    window.history.pushState({ page }, '', path);
    return;
  }
  if (!path && Object.values(PAGE_TO_PATH).includes(window.location.pathname as string)) {
    window.history.pushState({ page }, '', '/');
  }
}

export function isSuperAdminRole(role: string): boolean {
  return role === 'super_admin';
}
