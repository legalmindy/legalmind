import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CaseRecord, Client, DocumentItem, Lawyer, Office, PageId, SessionItem, SubscriptionPlan, User, UserRole } from '../types/app';
import { Briefcase, Calendar, Clock, FileText, Lock, MapPin, Plus, Printer, Search, Trash2, Edit3, Download, AlertCircle, MessageCircle, User as UserIcon, Loader2, Archive, Send, Sparkles, TrendingUp, TrendingDown, Wallet, ChevronDown, ChevronUp } from 'lucide-react';
import { StatCard } from '../components/StatCard';
import { MfaSettings } from '../components/MfaSettings';
import { FirmCodeCard } from '../components/FirmCodeCard';
import { ProfileAvatarUpload } from '../components/ProfileAvatarUpload';
import { SubscriptionUpgradeModal } from '../components/SubscriptionUpgradeModal';
import { SubscriptionFeatureList } from '../components/SubscriptionFeatureList';
import { SettingsToggleRow } from '../components/SettingsToggleRow';
import { useFirmProfile } from '../hooks/useSupabaseQueries';
import { useFirmSettings, useFirmSettingsMutations } from '../hooks/useFirmSettings';
import { subscriptionQueryKeys, useFirmSubscription, useSubscriptionRequests } from '../hooks/useSubscription';
import { SUBSCRIPTION_PLANS, getPlanLabel } from '../constants/subscription';
import { submitSubscriptionRequest } from '../lib/subscription';
import type { ProfileUpdateInput } from '../lib/profileImage';
import type { DashboardFinancials, DashboardPerformance, DashboardStatHints } from '../lib/dashboardAnalytics';
import { buildFinancialReport, formatPercent, formatYer } from '../lib/dashboardAnalytics';
import { useArchivedCases, useExpenses, useExpenseMutations } from '../hooks/useSupabaseQueries';

interface DashboardPageProps {
  user: User;
  sessions: SessionItem[];
  documents: DocumentItem[];
  activeChartTab: 'cases' | 'revenue';
  hoveredDataPoint: { month: string; cases: number; resolved: number; revenue: number } | null;
  setActiveChartTab: (tab: 'cases' | 'revenue') => void;
  setHoveredDataPoint: (data: { month: string; cases: number; resolved: number; revenue: number } | null) => void;
  stats: {
    totalClients: number;
    totalCases: number;
    activeCases: number;
    upcomingSessions: number;
    totalDocuments: number;
    lawyersCount: number;
  };
  monthlyData: { month: string; cases: number; resolved: number; revenue: number }[];
  performance: DashboardPerformance;
  financials: DashboardFinancials;
  statHints: DashboardStatHints;
  setCurrentPage: (page: PageId) => void;
  setShowClientModal: (value: boolean) => void;
  setShowCaseModal: (value: boolean) => void;
  setShowSessionModal: (value: boolean) => void;
  office?: Office;
  remindersEnabled?: boolean;
  onFirmCodeCopied?: (message: string) => void;
}

interface ClientsPageProps {
  clients: Client[];
  searchQuery: string;
  onSearch: (value: string) => void;
  onCreateClient: () => void;
  onEditClient: (client: Client) => void;
  onDeleteClient: (id: string) => void;
  onSendReport?: (client: Client) => void;
  canSendReport?: boolean;
}

interface CasesPageProps {
  cases: CaseRecord[];
  searchQuery: string;
  statusFilter: string;
  categoryFilter: string;
  onSearch: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onCategoryFilterChange: (value: string) => void;
  onCreateCase: () => void;
  onEditCase: (caseRecord: CaseRecord) => void;
  onArchiveCase: (caseRecord: CaseRecord) => void;
  onDeleteCase: (id: string) => void;
  onSendPaymentReminder?: (caseRecord: CaseRecord) => void;
  canSendPaymentReminder?: boolean;
}

interface SessionsPageProps {
  sessions: SessionItem[];
  onCreateSession: () => void;
  onEditSession: (session: SessionItem) => void;
  onDeleteSession: (id: string) => void;
}

interface DocumentsPageProps {
  documents: DocumentItem[];
  onCreateDocument: () => void;
  onGetUrl?: (docId: string) => Promise<string>;
}

interface LawyersPageProps {
  lawyers: Lawyer[];
}

interface ReportsPageProps {
  role: UserRole;
  performance: DashboardPerformance;
  financials: DashboardFinancials;
  cases: CaseRecord[];
  year?: number;
}

interface ProfilePageProps {
  user: User;
  onSave: (input: ProfileUpdateInput) => Promise<void>;
  onUploadAvatar: (file: File) => Promise<string>;
}

interface SettingsPageProps {
  user: User;
  office?: Office;
  onSaveOffice: (office: Office) => void;
  onFirmCodeCopied?: (message: string) => void;
}

export function DashboardPage({
  user,
  sessions,
  documents,
  activeChartTab,
  hoveredDataPoint,
  setActiveChartTab,
  setHoveredDataPoint,
  stats,
  monthlyData,
  performance,
  financials,
  statHints,
  setCurrentPage,
  setShowClientModal,
  setShowCaseModal,
  setShowSessionModal,
  office,
  remindersEnabled = true,
  onFirmCodeCopied
}: DashboardPageProps) {
  const isAdmin = user.role === 'admin' || user.role === 'firm_manager' || user.role === 'super_admin';
  const chartMaxCases = Math.max(1, ...monthlyData.map((d) => d.cases));
  const chartMaxRevenue = Math.max(1, ...monthlyData.map((d) => d.revenue));
  const currentYear = new Date().getFullYear();
  const { data: firmProfile } = useFirmProfile(isAdmin);
  const firmCode = office?.firmCode ?? firmProfile?.officeCode;
  const firmName = office?.name ?? firmProfile?.officeName ?? user.company;

  // Reminder strip: sessions today and tomorrow
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowStr = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0]; })();
  const todaySessions = sessions.filter((s) => s.date === todayStr && s.status !== 'ملغاة');
  const tomorrowSessions = sessions.filter((s) => s.date === tomorrowStr && s.status !== 'ملغاة');
  const showReminderStrip = remindersEnabled && (todaySessions.length > 0 || tomorrowSessions.length > 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
      <div className="bg-gradient-to-l from-slate-950 via-indigo-950 to-indigo-900 text-white p-6 sm:p-8 rounded-2xl shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-indigo-400/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row justify-between items-start gap-6 relative z-10">
          <div className="space-y-1 text-right flex-1 min-w-0">
            <span className="bg-amber-400/20 text-amber-300 text-[10px] font-bold tracking-wider px-3 py-1 rounded-full border border-amber-500/30 uppercase">
              بوابة المحامي المعتمدة لعام 2026
            </span>
            <h1 className="text-2xl sm:text-3xl font-black mt-2">مرحباً بك، {user.name}</h1>
            <p className="text-xs text-indigo-200 max-w-xl">مكتبك نشط ومحمي بالكامل. إليك تحليل الموقف القانوني وأعباء المرافعة الجارية.</p>
            <div className="flex flex-wrap gap-2.5 mt-4">
              <button type="button" onClick={() => { setShowClientModal(true); setCurrentPage('clients'); }} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow-md transition-all">
                <Plus className="w-4 h-4 stroke-[2.5]" /> تسجيل عميل جديد
              </button>
              <button type="button" onClick={() => { setShowCaseModal(true); setCurrentPage('cases'); }} className="bg-indigo-800 hover:bg-indigo-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 border border-indigo-700/80 transition-all">
                <Plus className="w-4 h-4 stroke-[2.5]" /> فتح قضية جديدة
              </button>
              <button type="button" onClick={() => { setShowSessionModal(true); setCurrentPage('sessions'); }} className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 border border-slate-800">
                <Calendar className="w-4 h-4" /> جدولة جلسة
              </button>
            </div>
          </div>

          {isAdmin && firmCode ? (
            <FirmCodeCard
              variant="hero"
              firmCode={firmCode}
              firmName={firmName}
              onCopied={onFirmCodeCopied}
            />
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="إجمالي القضايا النشطة" value={stats.activeCases} desc="قضايا تحت المرافعة" change={statHints.casesMonthlyChange} icon={Briefcase} iconBg="bg-amber-500/5" iconText="text-amber-500" borderStyle="border-amber-500/10" />
        <StatCard title="الموكلين المسجلين" value={stats.totalClients} desc="دليل عملاء المكتب" change={statHints.corporateClientsLabel} icon={UserIcon} iconBg="bg-indigo-500/5" iconText="text-indigo-500" borderStyle="border-indigo-500/10" />
        <StatCard title="الجلسات المجدولة" value={stats.upcomingSessions} desc="أجندة الحضور بالمحاكم" change={statHints.weeklySessionsLabel} icon={Calendar} iconBg="bg-emerald-500/5" iconText="text-emerald-500" borderStyle="border-emerald-500/10" />
        <StatCard title="الوثائق والأدلة" value={stats.totalDocuments} desc="مؤرشفة ومشفرة بالكامل" change={statHints.documentsStorageLabel} icon={FileText} iconBg="bg-rose-500/5" iconText="text-rose-500" borderStyle="border-rose-500/10" />
      </div>

      {showReminderStrip && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3" dir="rtl">
          <div className="flex items-center gap-2.5">
            <div className="bg-amber-100 border border-amber-200 rounded-xl p-2">
              <Clock className="w-4 h-4 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-black text-amber-900">تذكير الجلسات القادمة</h3>
              <p className="text-[11px] text-amber-600">
                {todaySessions.length > 0 && tomorrowSessions.length > 0
                  ? `${todaySessions.length} جلسة اليوم · ${tomorrowSessions.length} جلسة غداً`
                  : todaySessions.length > 0
                    ? `${todaySessions.length} جلسة مجدولة اليوم`
                    : `${tomorrowSessions.length} جلسة مجدولة غداً`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCurrentPage('sessions')}
              className="text-[11px] font-bold text-amber-700 hover:text-amber-900 border border-amber-300 hover:border-amber-400 bg-white rounded-lg px-3 py-1.5 transition-colors"
            >
              عرض الكل
            </button>
          </div>
          <div className="space-y-2">
            {[...todaySessions.map((s) => ({ ...s, label: 'اليوم', urgent: true })), ...tomorrowSessions.map((s) => ({ ...s, label: 'غداً', urgent: false }))].slice(0, 5).map((s) => (
              <div key={s.id} className={`flex items-center gap-3 bg-white rounded-xl px-3 py-2 border ${s.urgent ? 'border-amber-200' : 'border-slate-100'}`}>
                <span className={`shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-lg ${s.urgent ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-600'}`}>{s.label}</span>
                <span className="font-mono text-[11px] text-slate-500 shrink-0">{s.time}</span>
                <span className="flex-1 text-xs font-bold text-slate-800 truncate">{s.caseTitle}</span>
                <span className="text-[11px] text-slate-400 shrink-0 truncate max-w-[120px]">{s.court}</span>
              </div>
            ))}
            {(todaySessions.length + tomorrowSessions.length) > 5 && (
              <p className="text-[11px] text-amber-600 font-bold text-center">و {todaySessions.length + tomorrowSessions.length - 5} جلسات أخرى…</p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="space-y-0.5 text-right">
              <h3 className="font-extrabold text-slate-900 text-sm">مؤشرات الإيرادات ونشاط القضايا المنجزة</h3>
              <p className="text-[11px] text-slate-400">تفاعل بالوقوف على الأعمدة لرصد الأرقام بدقة لعام {currentYear}.</p>
            </div>
            <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
              <button type="button" onClick={() => { setActiveChartTab('cases'); setHoveredDataPoint(null); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeChartTab === 'cases' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>معدل القضايا</button>
              <button type="button" onClick={() => { setActiveChartTab('revenue'); setHoveredDataPoint(null); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeChartTab === 'revenue' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>أتعاب المحاماة</button>
            </div>
          </div>

          <div className="relative pt-6">
            <div className="h-64 w-full flex items-end justify-between gap-2.5 sm:gap-4 px-2">
              {monthlyData.map((data) => {
                const heightPercent = activeChartTab === 'cases'
                  ? (data.cases / chartMaxCases) * 100
                  : (data.revenue / chartMaxRevenue) * 100;
                return (
                  <div key={data.month} className="flex-1 flex flex-col items-center group relative cursor-pointer" onMouseEnter={() => setHoveredDataPoint(data)} onMouseLeave={() => setHoveredDataPoint(null)}>
                    <div className="w-full bg-slate-50 rounded-2xl h-48 flex items-end overflow-hidden relative border border-slate-100/50">
                      <div style={{ height: `${heightPercent}%` }} className={`w-full rounded-t-xl transition-all duration-500 group-hover:opacity-90 ${activeChartTab === 'cases' ? 'bg-indigo-600' : 'bg-amber-500'}`}>
                        <div className="absolute top-0 left-0 right-0 h-1/2 bg-white/5" />
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 mt-2.5">{data.month}</span>
                  </div>
                );
              })}
            </div>

            {hoveredDataPoint && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-slate-950 text-white p-3 rounded-xl shadow-xl border border-slate-800 text-right space-y-1.5 z-20 min-w-[160px]">
                <p className="text-xs font-bold border-b border-slate-800 pb-1 text-slate-400">{hoveredDataPoint.month} {currentYear}</p>
                {activeChartTab === 'cases' ? (
                  <div className="space-y-1">
                    <p className="text-[11px] text-slate-300">القضايا الجديدة: <strong className="text-indigo-400 text-xs font-mono">{hoveredDataPoint.cases} قضية</strong></p>
                    <p className="text-[11px] text-slate-300">تم الفصل فيها: <strong className="text-emerald-400 text-xs font-mono">{hoveredDataPoint.resolved} قضية</strong></p>
                  </div>
                ) : (
                  <div>
                    <p className="text-[11px] text-slate-300">إجمالي المقبوضات:</p>
                    <p className="text-sm font-black text-amber-400 font-mono mt-0.5">{hoveredDataPoint.revenue.toLocaleString()} ر.ي</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4 text-right">
          <div className="space-y-1">
            <h3 className="font-extrabold text-slate-900 text-sm">تحليل الأداء القانوني الإجمالي</h3>
            <p className="text-[11px] text-slate-400">إحصائيات النجاح ومعدل تسوية القضايا ودياً.</p>
          </div>

          {[
            { label: 'نسبة النجاح وكسب الأحكام', value: performance.winRate, color: 'bg-emerald-500', text: 'text-emerald-600' },
            { label: 'التسويات الودية والصلح الناجح', value: performance.settlementRate, color: 'bg-amber-500', text: 'text-amber-600' },
            { label: 'التزام الرد المتبادل وتقديم العرائض', value: performance.sessionCompliance, color: 'bg-indigo-600', text: 'text-indigo-600' }
          ].map((item) => (
            <div key={item.label} className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="font-bold text-slate-700">{item.label}</span>
                <span className={`font-black ${item.text}`}>{formatPercent(item.value)}</span>
              </div>
              <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                <div className={`${item.color} h-full rounded-full`} style={{ width: `${item.value}%` }} />
              </div>
            </div>
          ))}

          {financials.topPendingCase && financials.totalPendingFees > 0 ? (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 space-y-2 text-right">
              <div className="flex items-center gap-1.5 text-amber-600 font-bold text-xs">
                <AlertCircle className="w-4 h-4" />
                <span>تنبيه الموقف المالي للمكتب</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                هناك مبلغ <strong className="text-slate-900">{formatYer(financials.topPendingCase.remaining_amount)}</strong> معلق كمتبقي أتعاب مرافعة جارية
                {financials.topPendingCase.clientName ? (
                  <> لـ <strong className="text-slate-900">{financials.topPendingCase.clientName}</strong></>
                ) : null}.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-indigo-700" />
              <h3 className="font-bold text-slate-800 text-sm">الجلسات القادمة والمثول القانوني</h3>
            </div>
            <button type="button" onClick={() => setCurrentPage('sessions')} className="text-xs text-indigo-700 font-bold hover:underline">عرض التقويم بالكامل</button>
          </div>
          <div className="space-y-3.5">
            {sessions.map((session) => (
              <div key={session.id} className="bg-slate-50 p-4 rounded-2xl border border-slate-100/50 hover:border-amber-500/20 transition-all text-right space-y-2.5">
                <div className="flex justify-between items-start gap-2">
                  <span className="font-extrabold text-slate-800 text-xs line-clamp-1">{session.caseTitle}</span>
                  <span className="bg-amber-100 text-amber-900 font-mono font-bold text-[10px] px-2.5 py-0.5 rounded-full shrink-0">{session.time}</span>
                </div>
                <div className="flex flex-wrap gap-4 text-[11px] text-slate-500 items-center">
                  <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5 text-slate-400" />{session.court}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-slate-400" /><span className="font-semibold text-slate-700">{session.date}</span></span>
                </div>
                <div className="border-t border-slate-200/50 pt-2.5 flex justify-between items-center text-[11px]">
                  <span className="text-indigo-700 font-bold">المهمة بالجلسة: {session.type}</span>
                  <span className="text-slate-400">ملاحظة: {session.notes}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4 text-right">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-amber-500" />
              <h3 className="font-bold text-slate-800 text-sm">آخر الملفات والعرائض المرفوعة</h3>
            </div>
            <button type="button" onClick={() => setCurrentPage('documents')} className="text-xs text-indigo-700 font-bold hover:underline">المستندات</button>
          </div>

          <div className="space-y-3">
            {documents.map((doc) => (
              <div key={doc.id} className="bg-slate-50 p-3.5 rounded-xl border border-slate-100 flex justify-between items-center gap-3">
                <div className="flex items-center gap-2 text-right">
                  <div className="bg-indigo-50 text-indigo-700 p-2.5 rounded-lg shrink-0"><FileText className="w-5 h-5" /></div>
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-slate-800 line-clamp-1">{doc.title}</span>
                    <span className="text-[9px] text-slate-400 block">الحجم: {doc.size} | الرفع: {doc.dateUploaded}</span>
                  </div>
                </div>
                <button type="button" onClick={() => {}} className="p-1.5 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors" title="تحميل المستند">
                  <Download className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <button type="button" onClick={() => setCurrentPage('documents')} className="w-full text-center py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 rounded-xl text-xs font-bold transition-all">
            عرض خزانة المستندات الكاملة
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientsPage({ clients, searchQuery, onSearch, onCreateClient, onEditClient, onDeleteClient, onSendReport, canSendReport }: ClientsPageProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
        <div className="space-y-1 text-right">
          <h1 className="text-2xl font-black text-slate-900">إدارة دليل الموكلين والعملاء</h1>
          <p className="text-xs text-slate-500 font-medium">سجل ببيانات الموكلين الأفراد وممثلي الشركات ومتابعة نشاطاتهم القانونية.</p>
        </div>
        <button type="button" onClick={onCreateClient} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow">
          <Plus className="w-4 h-4 stroke-[2.5]" /> إضافة عميل جديد
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center">
        <div className="relative w-full">
          <Search className="absolute right-3.5 top-3 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="ابحث عن اسم العميل، رقم الهاتف، أو نوع الكيان..."
            value={searchQuery}
            onChange={(e) => onSearch(e.target.value)}
            className="w-full pr-10 pl-4 py-2 rounded-xl border border-slate-200 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none text-xs text-right"
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100">
              <tr>
                <th className="py-3.5 px-4 font-bold">اسم الموكل</th>
                <th className="py-3.5 px-4 font-bold">رقم الهاتف</th>
                <th className="py-3.5 px-4 font-bold">البريد الإلكتروني</th>
                <th className="py-3.5 px-4 font-bold">نوع الكيان</th>
                <th className="py-3.5 px-4 font-bold">العنوان</th>
                <th className="py-3.5 px-4 font-bold">قضايا</th>
                <th className="py-3.5 px-4 font-bold text-center">خيارات</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <td className="py-3.5 px-4 font-bold text-slate-800 text-sm">{client.name}</td>
                  <td className="py-3.5 px-4 font-mono text-slate-600">{client.phone}</td>
                  <td className="py-3.5 px-4 text-slate-500 font-mono">{client.email || '—'}</td>
                  <td className="py-3.5 px-4"><span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${client.type === 'شركة تجارية' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-700'}`}>{client.type}</span></td>
                  <td className="py-3.5 px-4 text-slate-500">{client.address}</td>
                  <td className="py-3.5 px-4 text-center font-bold text-indigo-700 font-mono text-sm">{client.casesCount}</td>
                  <td className="py-3.5 px-4">
                    <div className="flex items-center justify-center gap-1.5">
                      {canSendReport && onSendReport ? (
                        <button type="button" onClick={() => onSendReport(client)} className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors" title="إرسال تقرير">
                          <Send className="w-4.5 h-4.5" />
                        </button>
                      ) : null}
                      <button type="button" onClick={() => onEditClient(client)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors" title="تعديل العميل"><Edit3 className="w-4.5 h-4.5" /></button>
                      <button type="button" onClick={() => onDeleteClient(client.id)} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors" title="حذف العميل"><Trash2 className="w-4.5 h-4.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function CasesPage({ cases, searchQuery, statusFilter, categoryFilter, onSearch, onStatusFilterChange, onCategoryFilterChange, onCreateCase, onEditCase, onArchiveCase, onDeleteCase, onSendPaymentReminder, canSendPaymentReminder }: CasesPageProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-right">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-900">أرشيف وإدارة ملفات القضايا</h1>
          <p className="text-xs text-slate-500 font-medium">افتح، راقب، وعدّل القضايا المعروضة أمام المحاكم اليمنية.</p>
        </div>
        <button type="button" onClick={onCreateCase} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow">
          <Plus className="w-4 h-4 stroke-[2.5]" /> فتح قضية جديدة
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm flex items-center">
          <Search className="w-4 h-4 text-slate-400 mr-3" />
          <input type="text" placeholder="بحث عن القضية أو العميل" value={searchQuery} onChange={(e) => onSearch(e.target.value)} className="w-full text-right text-xs bg-transparent outline-none" />
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <label className="text-[10px] text-slate-500 mb-2 block">فلتر الحالة</label>
          <select value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none bg-white">
            <option value="الكل">الكل</option>
            <option value="active">نشط</option>
            <option value="archived">مؤرشف</option>
            <option value="closed">مغلق</option>
          </select>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
          <label className="text-[10px] text-slate-500 mb-2 block">فلتر التصنيف</label>
          <select value={categoryFilter} onChange={(e) => onCategoryFilterChange(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none bg-white">
            <option value="الكل">الكل</option>
            <option value="تجاري">تجاري</option>
            <option value="مدني">مدني</option>
            <option value="عقاري">عقاري</option>
            <option value="عمالي">عمالي</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cases.map((caseRecord) => {
          const hasPending = (caseRecord.remaining_amount ?? 0) > 0 && caseRecord.status === 'active';
          return (
            <div
              key={caseRecord.id}
              className={`bg-white rounded-2xl border shadow-sm p-6 space-y-4 transition-all text-right ${hasPending ? 'border-amber-300/60 hover:border-amber-400/80' : 'border-slate-100 hover:border-amber-500/30'}`}
            >
              <div className="flex justify-between items-start gap-3">
                <span className="bg-slate-100 text-slate-700 font-mono font-bold text-xs px-2.5 py-1 rounded">رقم {caseRecord.caseNo}</span>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {hasPending && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10px] font-bold border border-rose-100">
                      <AlertCircle className="w-3 h-3" />
                      مستحق
                    </span>
                  )}
                  <span className={`px-2.5 py-1 rounded text-xs font-bold ${caseRecord.status === 'active' ? 'bg-emerald-100 text-emerald-800' : caseRecord.status === 'archived' ? 'bg-amber-100 text-amber-800' : caseRecord.status === 'closed' ? 'bg-slate-100 text-slate-800' : 'bg-blue-100 text-indigo-900'}`}>{caseRecord.status === 'active' ? 'نشط' : caseRecord.status === 'archived' ? 'مؤرشف' : caseRecord.status === 'closed' ? 'مغلق' : caseRecord.status}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <h3 className="font-extrabold text-base text-slate-900 leading-snug line-clamp-2">{caseRecord.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{caseRecord.description}</p>
              </div>

              <div className="bg-slate-50 p-3.5 rounded-xl text-xs space-y-2">
                <div className="flex justify-between"><span className="text-slate-400">العميل:</span><span className="font-bold text-slate-800">{caseRecord.clientName}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المحامي المباشر:</span><span className="font-bold text-indigo-800">{caseRecord.lawyerName ?? 'غير معيّن'}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">المحكمة:</span><span className="font-bold text-slate-700">{caseRecord.court}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">التصنيف:</span><span className="font-semibold text-indigo-700">{caseRecord.category}</span></div>
              </div>

              {/* Financial summary */}
              {caseRecord.total_amount > 0 && (
                <div className={`rounded-xl text-xs px-3.5 py-3 space-y-1.5 border ${hasPending ? 'bg-amber-50 border-amber-100' : 'bg-emerald-50 border-emerald-100'}`}>
                  <div className="flex justify-between">
                    <span className="text-slate-500">إجمالي الأتعاب</span>
                    <span className="font-mono font-bold text-slate-700">{(caseRecord.total_amount).toLocaleString('ar-YE')} ر.ي</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">المسدّد</span>
                    <span className="font-mono font-bold text-emerald-700">{(caseRecord.paid_amount).toLocaleString('ar-YE')} ر.ي</span>
                  </div>
                  {hasPending ? (
                    <div className="flex justify-between border-t border-amber-200 pt-1.5">
                      <span className="font-bold text-rose-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> المتبقي المستحق</span>
                      <span className="font-mono font-black text-rose-700">{(caseRecord.remaining_amount).toLocaleString('ar-YE')} ر.ي</span>
                    </div>
                  ) : (
                    <div className="flex justify-between border-t border-emerald-200 pt-1.5">
                      <span className="font-bold text-emerald-600">الأتعاب مسدّدة بالكامل ✓</span>
                      <span className="font-mono font-bold text-emerald-700">0 ر.ي</span>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-slate-100 pt-4 flex justify-between items-center text-xs">
                <span className="text-slate-400">بدأت في: {caseRecord.dateStarted}</span>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {hasPending && canSendPaymentReminder && onSendPaymentReminder && (
                    <button
                      type="button"
                      onClick={() => onSendPaymentReminder(caseRecord)}
                      className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all border border-emerald-100"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      تذكير واتساب
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onArchiveCase(caseRecord)}
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-bold text-amber-800 transition-all hover:bg-amber-50"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    أرشفة
                  </button>
                  <button type="button" onClick={() => onEditCase(caseRecord)} className="px-3 py-1.5 hover:bg-indigo-50 text-indigo-700 rounded-lg font-bold transition-all">تعديل الملف</button>
                  <button type="button" onClick={() => onDeleteCase(caseRecord.id)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SessionsPage({ sessions, onCreateSession, onEditSession, onDeleteSession }: SessionsPageProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-right">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-900">أجندة مواعيد وجلسات المحاكم</h1>
          <p className="text-xs text-slate-500 font-medium">متابعة دقيقة لمواعيد الحضور والمرافعة وتقديم الدفوع.</p>
        </div>
        <button type="button" onClick={onCreateSession} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow">
          <Plus className="w-4 h-4 stroke-[2.5]" /> جدولة جلسة جديدة
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-100 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="py-3 px-4 font-bold">القضية</th>
                <th className="py-3 px-4 font-bold">المحكمة</th>
                <th className="py-3 px-4 font-bold">التاريخ</th>
                <th className="py-3 px-4 font-bold">الوقت</th>
                <th className="py-3 px-4 font-bold">نوع الجلسة</th>
                <th className="py-3 px-4 font-bold">الملاحظات</th>
                <th className="py-3 px-4 font-bold text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <td className="py-4 px-4 font-bold text-slate-800 max-w-xs">{session.caseTitle}</td>
                  <td className="py-4 px-4 text-slate-600">{session.court}</td>
                  <td className="py-4 px-4 font-bold text-indigo-800">{session.date}</td>
                  <td className="py-4 px-4"><span className="bg-amber-100 text-amber-900 font-mono font-bold px-2 py-1 rounded text-xs">{session.time}</span></td>
                  <td className="py-4 px-4 text-slate-700 font-semibold">{session.type}</td>
                  <td className="py-4 px-4 text-slate-500 max-w-xs">{session.notes || '—'}</td>
                  <td className="py-4 px-4 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button type="button" onClick={() => onEditSession(session)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"><Edit3 className="w-4.5 h-4.5" /></button>
                      <button type="button" onClick={() => onDeleteSession(session.id)} className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"><Trash2 className="w-4.5 h-4.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

function getFileExt(url: string): string {
  return (url.split('?')[0]?.split('.').pop() ?? '').toLowerCase();
}

function isImageDoc(doc: DocumentItem): boolean {
  return IMAGE_EXTS.includes(getFileExt(doc.url));
}

function DocTypeIcon({ category }: { category: string }) {
  const colorMap: Record<string, string> = {
    'عريضة دعوى':    'bg-blue-50 text-blue-700',
    'مذكرة دفاع':    'bg-purple-50 text-purple-700',
    'أدلة إثبات':    'bg-amber-50 text-amber-700',
    'توكيلات رسمية': 'bg-emerald-50 text-emerald-700',
    'حكم قضائي':     'bg-rose-50 text-rose-700',
    'تقارير فنية':   'bg-cyan-50 text-cyan-700',
    'عقد أو اتفاقية':'bg-indigo-50 text-indigo-700',
    'شهادة أو إفادة':'bg-orange-50 text-orange-700',
    'مراسلات رسمية': 'bg-teal-50 text-teal-700',
    'صورة أو إثبات': 'bg-pink-50 text-pink-700',
  };
  const cls = colorMap[category] ?? 'bg-slate-50 text-slate-700';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold ${cls}`}>
      {category}
    </span>
  );
}

function DocCard({ doc, onGetUrl }: { doc: DocumentItem; onGetUrl?: (id: string) => Promise<string> }) {
  const [loading, setLoading] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const isImg = isImageDoc(doc);

  const fetchFreshUrl = async (): Promise<string> => {
    if (onGetUrl) return await onGetUrl(doc.id);
    return doc.url;
  };

  const handleDownload = async () => {
    setLoading(true);
    try {
      const url = await fetchFreshUrl();
      // Use fetch to get the blob, then create object URL for forced download
      const response = await fetch(url);
      if (!response.ok) throw new Error('فشل التحميل');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = doc.title;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch {
      // Fallback: open in new tab
      const url = await fetchFreshUrl().catch(() => doc.url);
      window.open(url, '_blank');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = async () => {
    setPrintLoading(true);
    try {
      const url = await fetchFreshUrl();
      if (isImg) {
        // Open a same-origin window, inject HTML with the image, then print
        const win = window.open('', '_blank', 'width=900,height=700');
        if (win) {
          win.document.write(
            `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"/><title>${doc.title}</title>` +
            `<style>*{margin:0;padding:0;box-sizing:border-box}` +
            `body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#fff;font-family:sans-serif;gap:12px}` +
            `h2{font-size:14px;color:#333;padding:8px}` +
            `img{max-width:100%;max-height:90vh;object-fit:contain;box-shadow:0 2px 12px rgba(0,0,0,.15)}` +
            `@media print{h2{display:none}}` +
            `</style></head><body>` +
            `<h2>${doc.title}</h2>` +
            `<img src="${url}" onload="setTimeout(function(){window.print();},400)" onerror="document.body.innerHTML='<p>تعذر تحميل الصورة</p>'" />` +
            `</body></html>`
          );
          win.document.close();
        }
      } else {
        // PDF / DOCX: open in new tab — browser PDF viewer has built-in print button
        window.open(url, '_blank');
      }
    } catch {
      window.open(doc.url, '_blank');
    } finally {
      setPrintLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all text-right overflow-hidden group">
      {/* Thumbnail / preview */}
      <div className="relative h-32 bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center overflow-hidden">
        {isImg && doc.url ? (
          <img
            src={doc.url}
            alt={doc.title}
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="flex flex-col items-center gap-1">
            <FileText className="w-10 h-10 text-slate-300" />
            <span className="text-[10px] font-mono font-bold text-slate-400 uppercase">
              {getFileExt(doc.url) || 'doc'}
            </span>
          </div>
        )}
        <div className="absolute top-2 left-2">
          <span className="text-[9px] bg-black/40 text-white px-1.5 py-0.5 rounded font-mono">{doc.size}</span>
        </div>
      </div>

      {/* Info */}
      <div className="p-4 space-y-2">
        <h3 className="font-bold text-sm text-slate-800 line-clamp-2 leading-tight">{doc.title}</h3>
        <div className="flex flex-wrap gap-1">
          <DocTypeIcon category={doc.category} />
        </div>
        <p className="text-[10px] text-slate-400">رُفعت في: {doc.dateUploaded}</p>
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-900 hover:bg-indigo-800 disabled:opacity-50 text-white font-bold px-3 py-2 rounded-xl text-[11px] transition-colors"
        >
          {loading ? (
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <Download className="w-3.5 h-3.5" />
          )}
          تحميل
        </button>
        <button
          type="button"
          onClick={() => void handlePrint()}
          disabled={printLoading}
          title="طباعة المستند"
          className="flex items-center justify-center gap-1 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-600 font-bold px-3 py-2 rounded-xl text-[11px] transition-colors"
        >
          {printLoading ? (
            <span className="w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
          ) : (
            <Printer className="w-3.5 h-3.5" />
          )}
          طباعة
        </button>
      </div>
    </div>
  );
}

export function DocumentsPage({ documents, onCreateDocument, onGetUrl }: DocumentsPageProps) {
  // Group documents by case
  const grouped = useMemo(() => {
    const map = new Map<string, { caseTitle: string; docs: DocumentItem[] }>();
    for (const doc of documents) {
      const key = doc.caseId || '__no_case__';
      if (!map.has(key)) map.set(key, { caseTitle: doc.caseTitle || 'غير مرتبط بقضية', docs: [] });
      map.get(key)!.docs.push(doc);
    }
    return Array.from(map.entries());
  }, [documents]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-right">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-900">خزانة المستندات</h1>
          <p className="text-xs text-slate-500 font-medium">
            {documents.length} مستند — مرتبة حسب القضية
          </p>
        </div>
        <button
          type="button"
          onClick={onCreateDocument}
          className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow"
        >
          <Plus className="w-4 h-4" /> رفع وثيقة جديدة
        </button>
      </div>

      {documents.length === 0 && (
        <div className="text-center py-20 text-slate-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-bold text-sm">لا توجد مستندات بعد</p>
          <p className="text-xs mt-1">اضغط "رفع وثيقة جديدة" لإضافة أول مستند</p>
        </div>
      )}

      {/* Grouped by case */}
      {grouped.map(([caseId, group]) => (
        <div key={caseId} className="space-y-3">
          {/* Case label */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-indigo-900 text-white px-4 py-2 rounded-xl shadow-sm">
              <Briefcase className="w-4 h-4 opacity-80" />
              <span className="font-black text-xs">{group.caseTitle}</span>
            </div>
            <span className="text-[10px] text-slate-400 font-bold">{group.docs.length} مستند</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>

          {/* Documents grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {group.docs.map((doc) => (
              <DocCard key={doc.id} doc={doc} onGetUrl={onGetUrl} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LawyersPage({ lawyers }: LawyersPageProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-right">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-900">أعضاء المكتب والشركاء الممارسين</h1>
          <p className="text-xs text-slate-500 font-medium">قائمة المحامين والشركاء في المكتب القانوني لإدارة المرافعات.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 text-right">
        {lawyers.map((lawyer) => (
          <div key={lawyer.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-indigo-50 border border-slate-100 flex items-center justify-center text-indigo-950 font-bold mx-auto text-lg">{lawyer.name.substring(3, 5)}</div>
            <div>
              <h3 className="font-bold text-sm text-slate-800">{lawyer.name}</h3>
              <p className="text-[10px] text-amber-600 font-bold">{lawyer.role}</p>
              <p className="text-[11px] text-slate-500 mt-1">{lawyer.specialization}</p>
            </div>
            <div className="border-t border-slate-100 pt-3 flex flex-col gap-1 text-[11px] text-slate-400">
              <span className="font-mono">{lawyer.email}</span>
              <span className="font-mono">{lawyer.phone}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const EXPENSE_CATS = [
  'إيجار', 'رواتب', 'قرطاسية ومستلزمات مكتبية', 'اتصالات وإنترنت',
  'رسوم قضائية', 'تسويق وإعلان', 'صيانة وتجهيزات', 'مواصلات', 'أخرى'
] as const;

interface AddExpenseFormState {
  title: string;
  amount: string;
  category: string;
  expense_date: string;
  notes: string;
}

const EMPTY_EXPENSE_FORM: AddExpenseFormState = {
  title: '', amount: '', category: 'أخرى', expense_date: (new Date().toISOString().split('T')[0]) ?? '', notes: ''
};

export function ReportsPage({ role, performance, cases, year: propYear }: ReportsPageProps) {
  const accessDenied = role !== 'admin' && role !== 'firm_manager' && role !== 'super_admin';
  const currentYear = propYear ?? new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState<AddExpenseFormState>(EMPTY_EXPENSE_FORM);
  const [expenseError, setExpenseError] = useState('');

  const [deleteError, setDeleteError] = useState('');

  const { data: archivedCases = [] } = useArchivedCases(true);
  const { data: expenses = [], isLoading: expLoading } = useExpenses(true);
  const expMutations = useExpenseMutations();

  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm('حذف هذا المصروف؟')) return;
    setDeleteError('');
    try {
      await expMutations.removeExpense.mutateAsync(id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'فشل حذف المصروف';
      setDeleteError(msg);
    }
  };

  const report = useMemo(
    () => buildFinancialReport(cases, archivedCases, expenses, selectedYear),
    [cases, archivedCases, expenses, selectedYear]
  );

  const yearOptions = useMemo(() => {
    const years = new Set<number>([currentYear]);
    for (const c of [...cases, ...archivedCases]) {
      const y = parseInt(c.dateStarted?.split('-')[0] ?? '');
      if (y > 2015 && y <= currentYear + 1) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [cases, archivedCases, currentYear]);

  const maxMonthly = useMemo(
    () => Math.max(1, ...report.monthlyData.map((m) => Math.max(m.collected, m.expenses))),
    [report]
  );

  const handleAddExpense = async () => {
    if (!expenseForm.title.trim()) { setExpenseError('أدخل وصف المصروف'); return; }
    const amount = parseFloat(expenseForm.amount);
    if (!amount || amount <= 0) { setExpenseError('أدخل مبلغاً صحيحاً أكبر من صفر'); return; }
    setExpenseError('');
    try {
      await expMutations.addExpense.mutateAsync({
        title: expenseForm.title.trim(),
        amount,
        category: expenseForm.category,
        expense_date: expenseForm.expense_date,
        notes: expenseForm.notes.trim() || undefined
      });
      setExpenseForm(EMPTY_EXPENSE_FORM);
      setShowAddExpense(false);
    } catch (err) {
      setExpenseError(err instanceof Error ? err.message : 'فشل حفظ المصروف.');
    }
  };

  if (accessDenied) {
    return (
      <div className="max-w-7xl mx-auto px-4 mt-6">
        <div className="bg-white p-12 rounded-2xl border border-red-100 text-center space-y-4">
          <Lock className="w-12 h-12 text-rose-500 mx-auto" />
          <h3 className="font-extrabold text-slate-800 text-base">عذراً، الوصول غير مصرح به</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">التقارير المالية متاحة لمدراء المكاتب فقط.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6 text-right" dir="rtl">

      {/* Header */}
      <div className="bg-gradient-to-l from-slate-950 via-indigo-950 to-indigo-900 text-white p-6 rounded-2xl shadow-xl flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h1 className="text-2xl font-black">التقارير المالية والأداء القانوني</h1>
          <p className="text-xs text-indigo-200 mt-1">تحليل شامل للإيرادات، المصروفات، الأرباح الشهرية ومديونية العملاء.</p>
        </div>
        <select
          value={selectedYear}
          onChange={(e) => setSelectedYear(Number(e.target.value))}
          className="bg-white/10 border border-white/20 text-white rounded-xl px-3 py-2 text-sm font-bold outline-none hover:bg-white/20 transition-colors"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y} className="text-slate-900">{y}</option>
          ))}
        </select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold">
            <div className="bg-indigo-50 p-1.5 rounded-lg"><Briefcase className="w-3.5 h-3.5 text-indigo-500" /></div>
            إجمالي العقود
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">{formatYer(report.totalContracted)}</div>
          <p className="text-[11px] text-slate-400">مجموع أتعاب جميع القضايا</p>
        </div>
        <div className="bg-white rounded-2xl border border-emerald-100 p-5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold">
            <div className="bg-emerald-50 p-1.5 rounded-lg"><TrendingUp className="w-3.5 h-3.5 text-emerald-500" /></div>
            المحصّل
          </div>
          <div className="text-2xl font-black text-emerald-700 font-mono">{formatYer(report.totalCollected)}</div>
          <p className="text-[11px] text-slate-400">نسبة التحصيل: <strong className="text-emerald-600">{report.collectionRate}%</strong></p>
        </div>
        <div className="bg-white rounded-2xl border border-amber-100 p-5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold">
            <div className="bg-amber-50 p-1.5 rounded-lg"><Wallet className="w-3.5 h-3.5 text-amber-500" /></div>
            المتبقي المستحق
          </div>
          <div className="text-2xl font-black text-amber-700 font-mono">{formatYer(report.totalPending)}</div>
          <p className="text-[11px] text-slate-400">موزّع على {report.clientBreakdown.length} عميل</p>
        </div>
        <div className={`bg-white rounded-2xl border p-5 shadow-sm space-y-2 ${report.netProfit >= 0 ? 'border-emerald-100' : 'border-rose-100'}`}>
          <div className="flex items-center gap-2 text-slate-500 text-xs font-bold">
            <div className={`p-1.5 rounded-lg ${report.netProfit >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
              {report.netProfit >= 0
                ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                : <TrendingDown className="w-3.5 h-3.5 text-rose-500" />}
            </div>
            صافي الربح
          </div>
          <div className={`text-2xl font-black font-mono ${report.netProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{formatYer(report.netProfit)}</div>
          <p className="text-[11px] text-slate-400">المحصّل − المصروفات ({formatYer(report.totalExpenses)})</p>
        </div>
      </div>

      {/* Monthly Chart + Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <div>
            <h3 className="font-black text-slate-900 text-sm">الأرباح الشهرية — {selectedYear}</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">المحصّل (أخضر) مقابل المصروفات (أحمر) لكل شهر</p>
          </div>
          <div className="flex items-end justify-between gap-1 h-48 pt-2">
            {report.monthlyData.map((m) => (
              <div key={m.monthIndex} className="flex-1 flex flex-col items-center gap-0.5 group">
                <div className="w-full flex items-end justify-center gap-0.5" style={{ height: '152px' }}>
                  <div
                    title={`محصّل: ${formatYer(m.collected)}`}
                    className="w-[45%] bg-emerald-500 rounded-t-md hover:bg-emerald-400 transition-colors cursor-help"
                    style={{ height: `${(m.collected / maxMonthly) * 100}%`, minHeight: m.collected > 0 ? '4px' : '0' }}
                  />
                  <div
                    title={`مصروفات: ${formatYer(m.expenses)}`}
                    className="w-[45%] bg-rose-400 rounded-t-md hover:bg-rose-300 transition-colors cursor-help"
                    style={{ height: `${(m.expenses / maxMonthly) * 100}%`, minHeight: m.expenses > 0 ? '4px' : '0' }}
                  />
                </div>
                <div className={`text-[9px] font-bold mt-1 ${m.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {m.netProfit !== 0 ? (m.netProfit > 0 ? '+' : '') + Math.round(m.netProfit / 1000) + 'K' : '—'}
                </div>
                <span className="text-[9px] font-bold text-slate-400">{m.month.slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 text-[11px] font-bold text-slate-500 pt-2 border-t border-slate-100">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />محصّل</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-rose-400 inline-block" />مصروفات</span>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-4">
          <h3 className="font-black text-slate-900 text-sm">مؤشرات الأداء القانوني</h3>
          <div className="space-y-4">
            {[
              { label: 'معدل كسب الأحكام', value: performance.winRate, color: 'bg-indigo-500', desc: 'قضايا صدر لها حكم' },
              { label: 'معدل التسوية الودية', value: performance.settlementRate, color: 'bg-amber-500', desc: 'أُغلقت بتسوية' },
              { label: 'الالتزام بالجلسات', value: performance.sessionCompliance, color: 'bg-emerald-500', desc: 'جلسات مجدولة/قضية' }
            ].map((kpi) => (
              <div key={kpi.label} className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-[11px] font-black text-slate-700">{formatPercent(kpi.value)}</span>
                  <span className="text-xs text-slate-500 font-medium">{kpi.label}</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div className={`${kpi.color} h-2 rounded-full transition-all duration-700`} style={{ width: `${Math.min(100, kpi.value)}%` }} />
                </div>
                <p className="text-[10px] text-slate-400">{kpi.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Per-Client Pending Fees */}
      {report.clientBreakdown.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h3 className="font-black text-slate-900 text-sm">المتبقي عند كل عميل</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">مبالغ الأتعاب غير المسدّدة مرتبة تنازلياً</p>
          </div>
          <div className="divide-y divide-slate-50">
            {report.clientBreakdown.map((client) => {
              const pct = client.totalContract > 0 ? Math.round((client.totalPending / client.totalContract) * 100) : 100;
              const isExpanded = expandedClient === client.clientId;
              return (
                <div key={client.clientId}>
                  <button
                    type="button"
                    onClick={() => setExpandedClient(isExpanded ? null : client.clientId)}
                    className="w-full flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors text-right"
                  >
                    <div className="shrink-0">
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex justify-between items-center gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-slate-400">{client.caseCount} {client.caseCount === 1 ? 'قضية' : 'قضايا'}</span>
                          <span className="text-xs font-extrabold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-2 py-0.5 font-mono">{formatYer(client.totalPending)}</span>
                        </div>
                        <span className="font-bold text-slate-800 text-sm truncate">{client.clientName}</span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5">
                        <div className="bg-rose-400 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="bg-slate-50 border-t border-slate-100 px-6 py-3 space-y-2">
                      {client.cases.map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-4 text-xs bg-white rounded-xl px-4 py-2.5 border border-slate-100">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-rose-600 font-black shrink-0">{formatYer(c.remaining)}</span>
                            <span className="text-slate-400 shrink-0">المحصّل: {formatYer(c.paid)}</span>
                          </div>
                          <div className="text-right min-w-0">
                            <p className="font-bold text-slate-700 truncate">{c.title}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{c.caseNo}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Office Expenses */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => { setShowAddExpense((v) => !v); setExpenseError(''); setExpenseForm(EMPTY_EXPENSE_FORM); }}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            {showAddExpense ? 'إلغاء' : 'إضافة مصروف'}
          </button>
          <div className="text-right">
            <h3 className="font-black text-slate-900 text-sm">المصروفات المكتبية</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">الإيجار، الرواتب، المستلزمات — إجمالي: <strong className="text-rose-600 font-mono">{formatYer(report.totalExpenses)}</strong></p>
          </div>
        </div>

        {deleteError && (
          <div className="mx-6 mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-right">
            <p className="text-xs font-bold text-rose-700">{deleteError}</p>
            <button type="button" onClick={() => setDeleteError('')} className="text-[11px] text-rose-500 underline mt-1">إغلاق</button>
          </div>
        )}

        {showAddExpense && (
          <div className="p-6 border-b border-slate-100 bg-slate-50 space-y-3">
            <h4 className="font-bold text-slate-700 text-xs">بيانات المصروف الجديد</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">وصف المصروف *</label>
                <input
                  type="text"
                  value={expenseForm.title}
                  onChange={(e) => setExpenseForm((s) => ({ ...s, title: e.target.value }))}
                  placeholder="مثال: إيجار المكتب — يونيو"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">المبلغ (ر.ي) *</label>
                <input
                  type="number"
                  min={0}
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm((s) => ({ ...s, amount: e.target.value }))}
                  placeholder="0"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">التصنيف</label>
                <select
                  value={expenseForm.category}
                  onChange={(e) => setExpenseForm((s) => ({ ...s, category: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none bg-white focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                >
                  {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-500 block mb-1">التاريخ</label>
                <input
                  type="date"
                  value={expenseForm.expense_date}
                  onChange={(e) => setExpenseForm((s) => ({ ...s, expense_date: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-mono"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-bold text-slate-500 block mb-1">ملاحظات (اختياري)</label>
              <input
                type="text"
                value={expenseForm.notes}
                onChange={(e) => setExpenseForm((s) => ({ ...s, notes: e.target.value }))}
                placeholder="أي تفاصيل إضافية..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-right outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
              />
            </div>
            {expenseError && <p className="text-[11px] text-rose-600 font-bold">{expenseError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={expMutations.addExpense.isPending}
                onClick={() => void handleAddExpense()}
                className="bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-xl text-xs"
              >
                {expMutations.addExpense.isPending ? 'جاري الحفظ...' : 'حفظ المصروف'}
              </button>
              <button type="button" onClick={() => setShowAddExpense(false)} className="text-slate-500 hover:bg-slate-100 font-bold px-4 py-2 rounded-xl text-xs">
                إلغاء
              </button>
            </div>
          </div>
        )}

        {expLoading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-slate-400 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" /> جاري تحميل المصروفات...
          </div>
        ) : expenses.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400">
            <Wallet className="w-10 h-10 opacity-30" />
            <p className="text-sm font-bold">لا مصروفات مسجّلة بعد</p>
            <p className="text-xs">أضف مصروفات المكتب لحساب صافي الأرباح بدقة</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">التاريخ</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">البيان</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-right">التصنيف</th>
                  <th className="px-4 py-3 font-extrabold text-slate-500 text-left font-mono">المبلغ</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {expenses.map((exp) => (
                  <tr key={exp.id} className="hover:bg-slate-50/60 transition-colors group">
                    <td className="px-4 py-3 font-mono text-slate-500">{exp.expense_date}</td>
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800">{exp.title}</p>
                      {exp.notes && <p className="text-slate-400 mt-0.5">{exp.notes}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-slate-100 text-slate-600 font-bold px-2 py-0.5 rounded-lg">{exp.category}</span>
                    </td>
                    <td className="px-4 py-3 text-left font-mono font-black text-rose-600">{formatYer(exp.amount)}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void handleDeleteExpense(exp.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-rose-50 text-rose-400 hover:text-rose-600 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-rose-50 border-t-2 border-rose-100">
                  <td colSpan={3} className="px-4 py-3 font-extrabold text-rose-700 text-sm">الإجمالي</td>
                  <td className="px-4 py-3 text-left font-mono font-black text-rose-700 text-sm">{formatYer(report.totalExpenses)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

export function SubscriptionPage() {
  const queryClient = useQueryClient();
  const { data: subscription, isLoading: subscriptionLoading, isError: subscriptionError } = useFirmSubscription();
  const { data: requests = [], isLoading: requestsLoading } = useSubscriptionRequests();
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');

  const pending = requests.find((r) => r.status === 'pending');

  const handleSubmit = async (payload: { transferReference: string; receiptFile: File }) => {
    if (!selectedPlan) return;
    setSubmitting(true);
    try {
      await submitSubscriptionRequest({
        plan: selectedPlan.id,
        amountYer: selectedPlan.amountYer,
        transferReference: payload.transferReference,
        receiptFile: payload.receiptFile
      });
      setFeedback('تم إرسال طلب التجديد. سيتم مراجعته وتفعيل حسابك قريباً.');
      void queryClient.invalidateQueries({ queryKey: subscriptionQueryKeys.requests });
      setSelectedPlan(null);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'فشل إرسال طلب التجديد.');
    } finally {
      setSubmitting(false);
    }
  };

  if (subscriptionLoading || requestsLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 mt-10 flex justify-center text-slate-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-8 text-right">
      <div className="bg-gradient-to-l from-slate-900 to-indigo-950 p-6 sm:p-8 rounded-2xl text-white shadow-lg space-y-4">
        <div className="flex items-start gap-3 justify-end">
          <div className="text-right flex-1">
            <h1 className="text-2xl font-black">اشتراك LegalMind Yemen</h1>
            <p className="text-xs text-slate-300 font-medium mt-2 leading-relaxed max-w-2xl mr-auto">
              منصة سحابية متكاملة لإدارة المكاتب القانونية في اليمن — قضايا، موكلين، تنفيذ، تقارير، وفريق عمل في مكان واحد.
            </p>
          </div>
          <div className="shrink-0 w-11 h-11 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-amber-300" />
          </div>
        </div>
        {subscription ? (
          <div className="flex flex-wrap gap-2 text-xs pt-1">
            <span className="rounded-full bg-white/10 border border-white/15 px-3 py-1 font-bold">
              الباقة: {getPlanLabel(subscription.plan)}
            </span>
            <span className={`rounded-full px-3 py-1 font-bold ${subscription.isActive ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30' : 'bg-rose-500/20 text-rose-200 border border-rose-400/30'}`}>
              {subscription.isActive ? 'نشط' : subscription.status === 'trial' ? 'شهر مجاني' : 'منتهي / مقفل'}
            </span>
            {subscription.expiresAt ? (
              <span className="rounded-full bg-amber-500/20 text-amber-100 border border-amber-400/30 px-3 py-1 font-bold">
                ينتهي في: {subscription.expiresAt.split('T')[0]}
              </span>
            ) : null}
          </div>
        ) : null}
        {pending ? (
          <p className="text-xs text-indigo-100 font-bold bg-white/10 border border-white/15 rounded-xl px-3 py-2">
            طلب تجديد قيد المراجعة (رقم الحوالة: {pending.transferReference})
          </p>
        ) : null}
        {feedback ? (
          <p className={`text-xs font-bold ${feedback.includes('فشل') ? 'text-rose-700' : 'text-emerald-200'}`}>{feedback}</p>
        ) : null}
        {subscriptionError ? (
          <p className="text-xs text-rose-200 font-bold">تعذر تحميل حالة الاشتراك. تحقق من الاتصال بالإنترنت.</p>
        ) : null}
        <p className="text-[10px] text-slate-400">التحويل عبر بنك الكريمي — جميع الباقات تشمل المميزات الأساسية الكاملة.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-stretch">
        {SUBSCRIPTION_PLANS.map((plan) => (
          <div key={plan.id} className={`bg-white rounded-2xl border p-6 sm:p-8 flex flex-col relative transition-shadow hover:shadow-xl ${plan.color}`}>
            {plan.badge ? (
              <span className="absolute -top-3 right-6 bg-gradient-to-l from-amber-500 to-amber-400 text-slate-950 text-[10px] font-extrabold px-3 py-1 rounded-full shadow-md">
                {plan.badge}
              </span>
            ) : null}
            <div className="flex-1">
              <div className="space-y-1 mb-4">
                <h3 className="font-black text-lg text-slate-900">{plan.name}</h3>
                {plan.tagline ? <p className="text-[11px] text-slate-500 font-medium">{plan.tagline}</p> : null}
              </div>
              <div className="mb-1">
                <span className="text-3xl font-black text-slate-900 font-sans tracking-tight">{plan.price}</span>
                <span className="text-xs text-slate-400 mr-2 font-bold">ريال يمني — {plan.period}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 mb-5">
                {plan.monthlyEquivalent ? (
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1">
                    {plan.monthlyEquivalent}
                  </span>
                ) : null}
                {plan.savingsLabel ? (
                  <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                    {plan.savingsLabel}
                  </span>
                ) : null}
              </div>
              <div className="border-t border-slate-100 pt-5">
                <SubscriptionFeatureList features={plan.features} />
              </div>
            </div>
            <button
              type="button"
              disabled={Boolean(pending)}
              onClick={() => setSelectedPlan(plan)}
              className={`mt-8 w-full font-bold py-3 px-4 rounded-xl text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                plan.id === 'quarterly'
                  ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-md shadow-amber-500/20'
                  : plan.id === 'annual'
                    ? 'bg-indigo-950 hover:bg-indigo-900 text-white'
                    : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              {pending ? 'طلب قيد المراجعة' : 'اشتراك / تجديد الآن'}
            </button>
          </div>
        ))}
      </div>

      <SubscriptionUpgradeModal
        open={Boolean(selectedPlan)}
        plan={selectedPlan}
        submitting={submitting}
        onClose={() => setSelectedPlan(null)}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

export function ProfilePage({ user, onSave, onUploadAvatar }: ProfilePageProps) {
  const [form, setForm] = useState({
    name: user.name,
    phone: user.phone,
    licenseNo: user.licenseNo
  });
  const [imageUrl, setImageUrl] = useState(user.image);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setForm({ name: user.name, phone: user.phone, licenseNo: user.licenseNo });
    setImageUrl(user.image);
  }, [user]);

  const handleAvatarSelect = async (file: File) => {
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      const url = await onUploadAvatar(file);
      setImageUrl(url);
      await onSave({
        fullName: form.name,
        phone: form.phone,
        licenseNo: form.licenseNo,
        profileImage: url
      });
      setSuccess('تم تحديث الصورة الشخصية.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل رفع الصورة.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('يرجى إدخال الاسم الكامل.');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await onSave({
        fullName: form.name.trim(),
        phone: form.phone.trim(),
        licenseNo: form.licenseNo.trim(),
        profileImage: imageUrl
      });
      setSuccess('تم حفظ التعديلات بنجاح.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل حفظ الملف الشخصي.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto mt-6 px-4 space-y-6 text-right">
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
        <h2 className="text-xl font-black text-slate-900">الملف المهني والترخيص العدلي</h2>

        <ProfileAvatarUpload
          name={form.name}
          imageUrl={imageUrl}
          uploading={uploading}
          onFileSelect={(file) => void handleAvatarSelect(file)}
        />
        <p className="text-[11px] text-slate-500 text-center -mt-2">ستظهر صورتك في أعلى الصفحة بجانب اسم المكتب</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 mb-1 font-bold">الاسم الرباعي الكامل</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-right bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1 font-bold">البريد الإلكتروني المهني</label>
            <input type="email" value={user.email} disabled className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-400 text-right bg-slate-100 cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-slate-400 mb-1 font-bold">رقم الترخيص القانوني</label>
            <input
              type="text"
              value={form.licenseNo}
              onChange={(e) => setForm({ ...form, licenseNo: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-right bg-slate-50"
            />
          </div>
          <div>
            <label className="block text-slate-400 mb-1 font-bold">رقم الجوال اليمني</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-right bg-slate-50"
            />
          </div>
        </div>

        {error ? <p className="text-xs font-bold text-rose-600" role="alert">{error}</p> : null}
        {success ? <p className="text-xs font-bold text-emerald-600" role="status">{success}</p> : null}

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || uploading}
          className="bg-[#7A1F2B] hover:bg-[#641923] disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl text-xs inline-flex items-center gap-2"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          حفظ التعديلات والترخيص
        </button>
      </div>
    </div>
  );
}

export function SettingsPage({ user, office, onSaveOffice, onFirmCodeCopied }: SettingsPageProps) {
  const isAdmin = user.role === 'admin' || user.role === 'firm_manager' || user.role === 'super_admin';
  const { data: firmProfile } = useFirmProfile(isAdmin);
  const { data: firmSettings, isLoading: settingsLoading } = useFirmSettings(isAdmin);
  const { updateSettings } = useFirmSettingsMutations();
  const firmCode = office?.firmCode ?? firmProfile?.officeCode;
  const firmName = office?.name ?? firmProfile?.officeName ?? user.company;

  const [officeForm, setOfficeForm] = useState<Office>({
    id: '',
    name: user.company,
    licenseNo: user.licenseNo,
    plan: user.plan
  });

  const [settingsForm, setSettingsForm] = useState({
    remindersEnabled: true,
    whatsappReportsEnabled: true,
    smsReportsEnabled: false,
    hideFinancialsFromTrainees: true
  });

  useEffect(() => {
    if (office) setOfficeForm(office);
  }, [office]);

  useEffect(() => {
    if (firmSettings) {
      setSettingsForm({
        remindersEnabled: firmSettings.remindersEnabled,
        whatsappReportsEnabled: firmSettings.whatsappReportsEnabled,
        smsReportsEnabled: firmSettings.smsReportsEnabled,
        hideFinancialsFromTrainees: firmSettings.hideFinancialsFromTrainees
      });
    } else if (office) {
      setSettingsForm({
        remindersEnabled: office.remindersEnabled ?? true,
        whatsappReportsEnabled: office.whatsappReportsEnabled ?? true,
        smsReportsEnabled: office.smsReportsEnabled ?? false,
        hideFinancialsFromTrainees: office.hideFinancialsFromTrainees ?? true
      });
    }
  }, [firmSettings, office]);

  const saveSettings = () => {
    void updateSettings.mutateAsync(settingsForm).then(() => onFirmCodeCopied?.('تم حفظ إعدادات النظام.')).catch((err) => onFirmCodeCopied?.(err instanceof Error ? err.message : 'فشل حفظ الإعدادات.'));
  };

  return (
    <div className="max-w-3xl mx-auto mt-6 px-4 space-y-6 text-right">
      {isAdmin && firmCode ? (
        <FirmCodeCard firmCode={firmCode} firmName={firmName} onCopied={onFirmCodeCopied} />
      ) : null}
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm space-y-6">
        <h2 className="text-xl font-black text-slate-900">إعدادات النظام والمكتب القانوني</h2>
        <p className="text-xs text-slate-500">المكتب: {user.company} — الخطة: {user.plan}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block text-slate-500 mb-1 font-bold">اسم المكتب / مساحة العمل</label>
            <input
              type="text"
              value={officeForm.name}
              onChange={(e) => setOfficeForm({ ...officeForm, name: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-right"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1 font-bold">رقم ترخيص المكتب</label>
            <input
              type="text"
              value={officeForm.licenseNo}
              onChange={(e) => setOfficeForm({ ...officeForm, licenseNo: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-right"
            />
          </div>
        </div>
        <button type="button" onClick={() => onSaveOffice(officeForm)} disabled={!officeForm.id} className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold px-6 py-2.5 rounded-xl text-xs">
          حفظ بيانات المكتب
        </button>
        <div className="p-4 bg-slate-50 rounded-xl">
          <MfaSettings />
        </div>
        {isAdmin ? (
          <div className="rounded-xl border border-slate-100 px-4 bg-white">
            <h3 className="font-black text-slate-900 text-sm pt-4 pb-2">إعدادات الإشعارات والتقارير</h3>
            {settingsLoading ? (
              <p className="text-xs text-slate-400 py-4">جاري تحميل الإعدادات...</p>
            ) : (
              <>
                <SettingsToggleRow
                  title="التذكيرات الذكية"
                  description="عرض تنبيه بالجلسات المجدولة اليوم وغداً في لوحة التحكم، وإرسال إشعار داخلي عند إنشاء جلسة جديدة."
                  checked={settingsForm.remindersEnabled}
                  onChange={(remindersEnabled) => setSettingsForm((s) => ({ ...s, remindersEnabled }))}
                />
                <SettingsToggleRow
                  title="إرسال التقارير للعملاء عبر WhatsApp"
                  description="السماح بإرسال تقارير مختصرة للموكلين عبر واتساب."
                  checked={settingsForm.whatsappReportsEnabled}
                  onChange={(whatsappReportsEnabled) => setSettingsForm((s) => ({ ...s, whatsappReportsEnabled }))}
                />
                <SettingsToggleRow
                  title="إرسال التقارير للعملاء عبر رسائل SMS"
                  description="السماح بإرسال تقارير مختصرة للموكلين عبر رسائل نصية."
                  checked={settingsForm.smsReportsEnabled}
                  onChange={(smsReportsEnabled) => setSettingsForm((s) => ({ ...s, smsReportsEnabled }))}
                />
                <SettingsToggleRow
                  title="حظر رؤية المتدربين للمبالغ المالية"
                  description="تأمين حجب المذكرات المالية عن حسابات المتدربين."
                  checked={settingsForm.hideFinancialsFromTrainees}
                  onChange={(hideFinancialsFromTrainees) => setSettingsForm((s) => ({ ...s, hideFinancialsFromTrainees }))}
                />
              </>
            )}
          </div>
        ) : null}
        {isAdmin ? (
          <button type="button" onClick={saveSettings} disabled={updateSettings.isPending || settingsLoading} className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl text-xs">
            {updateSettings.isPending ? 'جاري الحفظ...' : 'تحديث إعدادات الأمان'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
