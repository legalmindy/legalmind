import type { CaseRecord, ChartPoint, Client, DocumentItem, Expense, SessionItem } from '../types/app';

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
] as const;

function parseCaseDate(value: string | undefined): Date | null {
  if (!value?.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isClosedCase(c: CaseRecord): boolean {
  return c.status === 'closed' || c.status === 'archived';
}

export interface DashboardPerformance {
  winRate: number;
  settlementRate: number;
  sessionCompliance: number;
}

export interface DashboardFinancials {
  totalPaidFees: number;
  totalPendingFees: number;
  topPendingCase?: CaseRecord;
}

// ─── Extended analytics types ────────────────────────────────────────────────

export interface ClientPendingFees {
  clientId: string;
  clientName: string;
  totalPending: number;
  totalContract: number;
  caseCount: number;
  cases: Array<{ id: string; title: string; caseNo: string; remaining: number; paid: number; total: number }>;
}

export interface MonthlyFinancial {
  month: string;
  monthIndex: number;
  year: number;
  collected: number;
  contracts: number;
  expenses: number;
  netProfit: number;
  caseCount: number;
}

export interface FinancialReport {
  totalContracted: number;
  totalCollected: number;
  totalPending: number;
  totalExpenses: number;
  netProfit: number;
  collectionRate: number;
  clientBreakdown: ClientPendingFees[];
  monthlyData: MonthlyFinancial[];
}

export interface DashboardStatHints {
  casesMonthlyChange: string;
  corporateClientsLabel: string;
  weeklySessionsLabel: string;
  documentsStorageLabel: string;
}

export function buildMonthlyChartData(cases: CaseRecord[], year = new Date().getFullYear()): ChartPoint[] {
  const buckets = ARABIC_MONTHS.map((month) => ({
    month,
    cases: 0,
    resolved: 0,
    revenue: 0
  }));

  for (const c of cases) {
    const started = parseCaseDate(c.dateStarted);
    if (started && started.getFullYear() === year) {
      const bucket = buckets[started.getMonth()];
      if (bucket) {
        bucket.cases += 1;
        bucket.revenue += c.paid_amount ?? 0;
      }
    }

    const closedAt = parseCaseDate(c.archive_date ?? c.judgment_date);
    if (closedAt && closedAt.getFullYear() === year && isClosedCase(c)) {
      const bucket = buckets[closedAt.getMonth()];
      if (bucket) bucket.resolved += 1;
    }
  }

  const currentMonth = new Date().getMonth();
  const windowStart = Math.max(0, currentMonth - 5);
  return buckets.slice(windowStart, currentMonth + 1);
}

export function buildPerformanceMetrics(cases: CaseRecord[], sessions: SessionItem[]): DashboardPerformance {
  const closed = cases.filter(isClosedCase);
  const withJudgment = closed.filter((c) => Boolean(c.judgment_date?.trim()));
  const settled = closed.filter((c) => !c.judgment_date?.trim());

  const winRate = closed.length ? Math.round((withJudgment.length / closed.length) * 100) : 0;
  const settlementRate = closed.length ? Math.round((settled.length / closed.length) * 100) : 0;

  const activeCases = cases.filter((c) => c.status === 'active').length;
  const scheduledSessions = sessions.filter((s) => s.status === 'مجدولة').length;
  const sessionCompliance = activeCases
    ? Math.min(100, Math.round((scheduledSessions / activeCases) * 100))
    : scheduledSessions > 0 ? 100 : 0;

  return { winRate, settlementRate, sessionCompliance };
}

export function buildFinancialSummary(cases: CaseRecord[]): DashboardFinancials {
  const totalPaidFees = cases.reduce((sum, c) => sum + (c.paid_amount ?? 0), 0);
  const totalPendingFees = cases
    .filter((c) => c.status === 'active')
    .reduce((sum, c) => sum + (c.remaining_amount ?? 0), 0);

  const topPendingCase = cases
    .filter((c) => c.status === 'active' && (c.remaining_amount ?? 0) > 0)
    .sort((a, b) => (b.remaining_amount ?? 0) - (a.remaining_amount ?? 0))[0];

  return { totalPaidFees, totalPendingFees, topPendingCase };
}

export function buildStatHints(
  cases: CaseRecord[],
  clients: Client[],
  sessions: SessionItem[],
  documents: DocumentItem[]
): DashboardStatHints {
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  const casesThisMonth = cases.filter((c) => {
    const d = parseCaseDate(c.dateStarted);
    return d && d.getMonth() === thisMonth && d.getFullYear() === thisYear;
  }).length;

  const casesLastMonth = cases.filter((c) => {
    const d = parseCaseDate(c.dateStarted);
    if (!d) return false;
    const last = new Date(thisYear, thisMonth - 1, 1);
    return d.getMonth() === last.getMonth() && d.getFullYear() === last.getFullYear();
  }).length;

  const changePct = casesLastMonth
    ? Math.round(((casesThisMonth - casesLastMonth) / casesLastMonth) * 100)
    : casesThisMonth > 0 ? 100 : 0;

  const corporateCount = clients.filter((c) => c.type === 'شركة تجارية').length;

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 7);

  const sessionsThisWeek = sessions.filter((s) => {
    const d = parseCaseDate(s.date);
    return d && d >= weekStart && d < weekEnd && s.status === 'مجدولة';
  }).length;

  const totalBytes = documents.reduce((sum, doc) => {
    const match = doc.size.match(/([\d.]+)\s*(KB|MB|GB)?/i);
    if (!match?.[1]) return sum;
    const n = parseFloat(match[1]);
    const unit = (match[2] ?? 'KB').toUpperCase();
    if (unit === 'GB') return sum + n * 1024 * 1024 * 1024;
    if (unit === 'MB') return sum + n * 1024 * 1024;
    return sum + n * 1024;
  }, 0);

  const storageLabel = totalBytes >= 1024 * 1024 * 1024
    ? `${(totalBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
    : totalBytes >= 1024 * 1024
      ? `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`
      : `${documents.length} ملف`;

  return {
    casesMonthlyChange: changePct >= 0 ? `+${changePct}% هذا الشهر` : `${changePct}% هذا الشهر`,
    corporateClientsLabel: corporateCount
      ? `${corporateCount} ${corporateCount === 1 ? 'شركة تجارية' : 'شركات تجارية'}`
      : 'لا شركات مسجلة بعد',
    weeklySessionsLabel: sessionsThisWeek
      ? `${sessionsThisWeek} ${sessionsThisWeek === 1 ? 'جلسة' : 'جلسات'} هذا الأسبوع`
      : 'لا جلسات هذا الأسبوع',
    documentsStorageLabel: documents.length ? storageLabel : 'لا مستندات بعد'
  };
}

export function formatYer(amount: number): string {
  return `${Math.round(amount).toLocaleString('ar-YE')} ر.ي`;
}

export function formatPercent(value: number): string {
  return `${value.toLocaleString('ar-YE', { maximumFractionDigits: 1 })}%`;
}

// ─── Full Financial Report Builder ───────────────────────────────────────────

export function buildClientPendingBreakdown(
  cases: CaseRecord[],
  archivedCases: CaseRecord[] = []
): ClientPendingFees[] {
  const all = [...cases, ...archivedCases];
  const map = new Map<string, ClientPendingFees>();

  for (const c of all) {
    const remaining = c.remaining_amount ?? 0;
    if (remaining <= 0) continue;
    const key = c.clientId;
    if (!map.has(key)) {
      map.set(key, {
        clientId: c.clientId,
        clientName: c.clientName,
        totalPending: 0,
        totalContract: 0,
        caseCount: 0,
        cases: []
      });
    }
    const entry = map.get(key)!;
    entry.totalPending += remaining;
    entry.totalContract += c.total_amount ?? 0;
    entry.caseCount += 1;
    entry.cases.push({ id: c.id, title: c.title, caseNo: c.caseNo, remaining, paid: c.paid_amount ?? 0, total: c.total_amount ?? 0 });
  }

  return Array.from(map.values()).sort((a, b) => b.totalPending - a.totalPending);
}

export function buildMonthlyFinancials(
  cases: CaseRecord[],
  archivedCases: CaseRecord[] = [],
  expenses: Expense[] = [],
  year = new Date().getFullYear()
): MonthlyFinancial[] {
  const all = [...cases, ...archivedCases];
  const buckets: MonthlyFinancial[] = ARABIC_MONTHS.map((month, i) => ({
    month,
    monthIndex: i,
    year,
    collected: 0,
    contracts: 0,
    expenses: 0,
    netProfit: 0,
    caseCount: 0
  }));

  for (const c of all) {
    const d = parseCaseDate(c.dateStarted);
    if (!d || d.getFullYear() !== year) continue;
    const b = buckets[d.getMonth()];
    if (!b) continue;
    b.collected += c.paid_amount ?? 0;
    b.contracts += c.total_amount ?? 0;
    b.caseCount += 1;
  }

  for (const e of expenses) {
    const d = new Date(e.expense_date);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) continue;
    const b = buckets[d.getMonth()];
    if (b) b.expenses += e.amount;
  }

  for (const b of buckets) {
    b.netProfit = b.collected - b.expenses;
  }

  return buckets;
}

export function buildFinancialReport(
  cases: CaseRecord[],
  archivedCases: CaseRecord[] = [],
  expenses: Expense[] = [],
  year = new Date().getFullYear()
): FinancialReport {
  const all = [...cases, ...archivedCases];
  const totalContracted = all.reduce((s, c) => s + (c.total_amount ?? 0), 0);
  const totalCollected = all.reduce((s, c) => s + (c.paid_amount ?? 0), 0);
  const totalPending = all.reduce((s, c) => s + (c.remaining_amount ?? 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const netProfit = totalCollected - totalExpenses;
  const collectionRate = totalContracted > 0 ? Math.round((totalCollected / totalContracted) * 100) : 0;

  return {
    totalContracted,
    totalCollected,
    totalPending,
    totalExpenses,
    netProfit,
    collectionRate,
    clientBreakdown: buildClientPendingBreakdown(cases, archivedCases),
    monthlyData: buildMonthlyFinancials(cases, archivedCases, expenses, year)
  };
}
