import type { CaseDetailTab, PageId } from '../types/app';

const PATH_TO_PAGE: Record<string, PageId> = {
  '/admin/billing': 'admin-billing',
  '/subscription': 'subscription',
  '/login': 'login',
  '/register-office': 'register-office',
  '/register-lawyer': 'register-lawyer',
  '/audit-logs': 'audit-logs',
  '/office-manager': 'office-manager'
};

const PAGE_TO_PATH: Partial<Record<PageId, string>> = {
  'admin-billing': '/admin/billing',
  subscription: '/subscription',
  login: '/login',
  'register-office': '/register-office',
  'register-lawyer': '/register-lawyer',
  'audit-logs': '/audit-logs',
  'office-manager': '/office-manager'
};

export function resolveCaseIdFromLocation(): string | null {
  const match = window.location.pathname.match(/^\/case\/([0-9a-f-]{36})$/i);
  return match?.[1] ?? null;
}

const CASE_DETAIL_TAB_KEY = 'legalmind:caseDetailTab';

export function stashCaseDetailTab(tab: CaseDetailTab): void {
  sessionStorage.setItem(CASE_DETAIL_TAB_KEY, tab);
}

export function consumeCaseDetailTab(): CaseDetailTab | null {
  const stored = sessionStorage.getItem(CASE_DETAIL_TAB_KEY);
  sessionStorage.removeItem(CASE_DETAIL_TAB_KEY);
  if (
    stored === 'overview' ||
    stored === 'sessions' ||
    stored === 'documents' ||
    stored === 'financials' ||
    stored === 'payments' ||
    stored === 'receipts' ||
    stored === 'timeline' ||
    stored === 'notes' ||
    stored === 'lawyers'
  ) {
    return stored;
  }
  return null;
}

export function syncCaseDetailLocation(caseId: string): void {
  const path = `/case/${caseId}`;
  if (window.location.pathname !== path) {
    window.history.pushState({ page: 'case-detail', caseId }, '', path);
  }
}

export function clearCaseDetailLocation(): void {
  if (window.location.pathname.startsWith('/case/')) {
    window.history.pushState({ page: 'cases' }, '', '/');
  }
}

export function resolvePageFromLocation(): { page: PageId | null; caseId?: string } {
  const path = window.location.pathname.replace(/\/$/, '') || '/';
  const caseId = resolveCaseIdFromLocation();
  if (caseId) return { page: 'case-detail', caseId };
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

export function isBillingAdminAccess(role: string, isBillingAdminDb: boolean): boolean {
  return isSuperAdminRole(role) || isBillingAdminDb;
}
