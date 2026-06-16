import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CaseRecord, Client, DocumentItem, Lawyer, Office, PageId, SessionItem, SubscriptionPlan, User, UserRole } from '../types/app';
import { Briefcase, Calendar, Clock, FileText, Lock, MapPin, Plus, Search, Trash2, Edit3, Download, AlertCircle, MessageCircle, User as UserIcon, Loader2, Archive, Send, Sparkles } from 'lucide-react';
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
import { formatPercent, formatYer } from '../lib/dashboardAnalytics';

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
}

interface LawyersPageProps {
  lawyers: Lawyer[];
}

interface ReportsPageProps {
  role: UserRole;
  performance: DashboardPerformance;
  financials: DashboardFinancials;
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
  onFirmCodeCopied
}: DashboardPageProps) {
  const isAdmin = user.role === 'admin' || user.role === 'firm_manager' || user.role === 'super_admin';
  const chartMaxCases = Math.max(1, ...monthlyData.map((d) => d.cases));
  const chartMaxRevenue = Math.max(1, ...monthlyData.map((d) => d.revenue));
  const currentYear = new Date().getFullYear();
  const { data: firmProfile } = useFirmProfile(isAdmin);
  const firmCode = office?.firmCode ?? firmProfile?.officeCode;
  const firmName = office?.name ?? firmProfile?.officeName ?? user.company;

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

export function DocumentsPage({ documents, onCreateDocument }: DocumentsPageProps) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-right">
        <div className="space-y-1">
          <h1 className="text-2xl font-black text-slate-900">خزانة المستندات والملفات الآمنة</h1>
          <p className="text-xs text-slate-500 font-medium">تخزين ومشاركة العرائض والأدلة والوثائق القانونية على سحابة آمنة.</p>
        </div>
        <button type="button" onClick={onCreateDocument} className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow">
          <Plus className="w-4 h-4" /> رفع وثيقة جديدة
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {documents.map((doc) => (
          <div key={doc.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4 hover:border-indigo-500/20 transition-all text-right">
            <div className="flex justify-between items-start">
              <div className="bg-indigo-50 text-indigo-700 p-3 rounded-xl">
                <FileText className="w-6 h-6" />
              </div>
              <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded font-mono font-bold">{doc.size}</span>
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-sm text-slate-800 line-clamp-1">{doc.title}</h3>
              <p className="text-[11px] text-slate-400 line-clamp-1">القضية: {doc.caseTitle}</p>
              <span className="inline-block text-[10px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded font-semibold mt-1">{doc.category}</span>
            </div>
            <div className="border-t border-slate-100 pt-3 flex justify-between items-center text-[10px] text-slate-400">
              <span>رُفعت في: {doc.dateUploaded}</span>
              <button type="button" className="text-indigo-700 font-bold hover:underline flex items-center gap-1 text-[11px]"><Download className="w-3.5 h-3.5" /> تحميل المستند</button>
            </div>
          </div>
        ))}
      </div>
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

export function ReportsPage({ role, performance, financials }: ReportsPageProps) {
  const accessDenied = role !== 'admin' && role !== 'firm_manager';
  const currentYear = new Date().getFullYear();
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-6 space-y-8">
      <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm text-right">
        <h1 className="text-2xl font-black text-slate-900">مؤشرات الأداء القانوني والتحليلات المالية</h1>
        <p className="text-xs text-slate-500 font-medium">متابعة إيرادات الأتعاب، كفاءة إغلاق القضايا ونسب كسب الأحكام.</p>
      </div>
      {accessDenied ? (
        <div className="bg-white p-12 rounded-2xl border border-red-100 text-center space-y-4">
          <Lock className="w-12 h-12 text-rose-500 mx-auto" />
          <h3 className="font-extrabold text-slate-800 text-base">عذراً، الوصول غير مصرح به</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">تقتصر صلاحية استعراض التقارير المالية وتحليل إيرادات المكتب على مدراء المكاتب ومسؤولي النظام الكاملين فقط.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-100 space-y-4 text-right shadow-sm">
            <h3 className="font-bold text-slate-800 text-sm">أتعاب المحاماة الإجمالية</h3>
            <div className="text-3xl font-black text-emerald-600 font-mono">{formatYer(financials.totalPaidFees)}</div>
            <p className="text-xs text-slate-400">إجمالي المبالغ المحصّلة المسجلة في قضايا هذا المكتب.</p>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-100 space-y-4 text-right shadow-sm">
            <h3 className="font-bold text-slate-800 text-sm">معدل الفوز بالأحكام المنجزة</h3>
            <div className="text-3xl font-black text-indigo-600 font-mono">{formatPercent(performance.winRate)}</div>
            <p className="text-xs text-slate-400">نسبة القضايا المغلقة التي سُجّل لها تاريخ حكم لعام {currentYear}.</p>
          </div>
        </div>
      )}
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
                  title="التذكيرات"
                  description="تفعيل تذكيرات الجلسات والمواعيد للموكلين والفريق."
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
