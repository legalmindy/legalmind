import { Briefcase, Calendar, Clock, FileText, MapPin, Plus, Download, AlertCircle, User as UserIcon, TrendingUp, Banknote, HardDrive, Database, History, Lock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { SubscriptionStatusBanner } from '../../components/SubscriptionStatusBanner';
import { StatCard } from '../../components/StatCard';
import { FirmCodeCard } from '../../components/FirmCodeCard';
import { useFirmProfile } from '../../hooks/useSupabaseQueries';
import { useFirmSubscription } from '../../hooks/useSubscription';
import { formatPercent, formatYer } from '../../lib/dashboardAnalytics';
import { hasPermission } from '../../lib/permissions';
import { fetchFirmSecurityStats } from '../../lib/securityApi';
import { formatActivityDateTime } from '../../lib/auditLogLabels';
import type { DashboardPageProps } from './types';
export function DashboardPage({
  user,
  permissions,
  role,
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
  const userRole = role ?? user.role;
  const isAdmin = userRole === 'admin' || userRole === 'firm_manager' || userRole === 'super_admin';
  const isFirmManager = userRole === 'firm_manager';
  const { data: securityStats } = useQuery({
    queryKey: ['firm-security-stats'],
    queryFn: fetchFirmSecurityStats,
    enabled: isFirmManager
  });
  const canCreateClient = hasPermission(permissions, 'clients.create', userRole);
  const canCreateCase = hasPermission(permissions, 'cases.create', userRole);
  const canCreateSession = hasPermission(permissions, 'sessions.create', userRole);
  const canViewReports = hasPermission(permissions, 'financials.view', userRole);
  const canAddPayments = hasPermission(permissions, 'financials.add_payments', userRole);
  const canViewCases = hasPermission(permissions, 'cases.view', userRole);
  const isFinancialFocus = canViewReports && !canCreateClient && !canCreateCase && !canCreateSession;
  const chartMaxCases = Math.max(1, ...monthlyData.map((d) => d.cases));
  const chartMaxRevenue = Math.max(1, ...monthlyData.map((d) => d.revenue));
  const currentYear = new Date().getFullYear();
  const { data: firmProfile } = useFirmProfile(isAdmin);
  const { data: subscription } = useFirmSubscription(true);
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
              {isFinancialFocus ? 'بوابة المحاسب — LegalMind Yemen' : 'بوابة المحامي المعتمدة لعام 2026'}
            </span>
            <h1 className="text-2xl sm:text-3xl font-black mt-2">مرحباً بك، {user.name}</h1>
            <p className="text-xs text-indigo-200 max-w-xl">
              {isFinancialFocus
                ? 'تابع التحصيلات والمديونيات والمصروفات المكتبية من لوحة واحدة.'
                : 'مكتبك نشط ومحمي بالكامل. إليك تحليل الموقف القانوني وأعباء المرافعة الجارية.'}
            </p>
            <div className="flex flex-wrap gap-2.5 mt-4">
              {canCreateClient ? (
                <button type="button" onClick={() => { setShowClientModal(true); setCurrentPage('clients'); }} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow-md transition-all">
                  <Plus className="w-4 h-4 stroke-[2.5]" /> تسجيل عميل جديد
                </button>
              ) : null}
              {canCreateCase ? (
                <button type="button" onClick={() => { setShowCaseModal(true); setCurrentPage('cases'); }} className="bg-indigo-800 hover:bg-indigo-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 border border-indigo-700/80 transition-all">
                  <Plus className="w-4 h-4 stroke-[2.5]" /> فتح قضية جديدة
                </button>
              ) : null}
              {canCreateSession ? (
                <button type="button" onClick={() => { setShowSessionModal(true); setCurrentPage('sessions'); }} className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 border border-slate-800">
                  <Calendar className="w-4 h-4" /> جدولة جلسة
                </button>
              ) : null}
              {canViewReports ? (
                <button type="button" onClick={() => setCurrentPage('reports')} className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow-md transition-all">
                  <TrendingUp className="w-4 h-4" /> التقارير المالية
                </button>
              ) : null}
              {canAddPayments && canViewCases ? (
                <button type="button" onClick={() => setCurrentPage('cases')} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow-md transition-all">
                  <Banknote className="w-4 h-4" /> تسجيل دفعة على قضية
                </button>
              ) : null}
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

      <SubscriptionStatusBanner subscription={subscription} onNavigate={setCurrentPage} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="إجمالي القضايا النشطة" value={stats.activeCases} desc="قضايا تحت المرافعة" change={statHints.casesMonthlyChange} icon={Briefcase} iconBg="bg-amber-500/5" iconText="text-amber-500" borderStyle="border-amber-500/10" />
        <StatCard title="الموكلين المسجلين" value={stats.totalClients} desc="دليل عملاء المكتب" change={statHints.corporateClientsLabel} icon={UserIcon} iconBg="bg-indigo-500/5" iconText="text-indigo-500" borderStyle="border-indigo-500/10" />
        <StatCard title="الجلسات المجدولة" value={stats.upcomingSessions} desc="أجندة الحضور بالمحاكم" change={statHints.weeklySessionsLabel} icon={Calendar} iconBg="bg-emerald-500/5" iconText="text-emerald-500" borderStyle="border-emerald-500/10" />
        <StatCard title="الوثائق والأدلة" value={stats.totalDocuments} desc="مؤرشفة ومشفرة بالكامل" change={statHints.documentsStorageLabel} icon={FileText} iconBg="bg-rose-500/5" iconText="text-rose-500" borderStyle="border-rose-500/10" />
      </div>

      {isFirmManager && securityStats ? (
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-black text-slate-900">إحصائيات الأمان والإدارة</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <HardDrive className="mx-auto mb-1 h-5 w-5 text-indigo-700" />
              <p className="text-lg font-black text-slate-900">{securityStats.backupCount}</p>
              <p className="text-[10px] font-bold text-slate-500">نسخ احتياطية</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <Clock className="mx-auto mb-1 h-5 w-5 text-amber-600" />
              <p className="text-[10px] font-black text-slate-800 leading-tight">
                {securityStats.lastBackupAt ? formatActivityDateTime(securityStats.lastBackupAt).split(' ')[0] : '—'}
              </p>
              <p className="text-[10px] font-bold text-slate-500">آخر نسخة</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <Database className="mx-auto mb-1 h-5 w-5 text-[#7A1F2B]" />
              <p className="text-lg font-black text-slate-900">{securityStats.exportCount}</p>
              <p className="text-[10px] font-bold text-slate-500">عمليات تصدير</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <Lock className="mx-auto mb-1 h-5 w-5 text-emerald-700" />
              <p className="text-lg font-black text-slate-900">{securityStats.encryptedFilesCount}</p>
              <p className="text-[10px] font-bold text-slate-500">ملفات مشفرة</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3 text-center">
              <History className="mx-auto mb-1 h-5 w-5 text-slate-600" />
              <p className="text-lg font-black text-slate-900">{securityStats.auditLogCount}</p>
              <p className="text-[10px] font-bold text-slate-500">سجلات تدقيق</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setCurrentPage('trust-security')} className="rounded-lg bg-[#7A1F2B]/10 px-3 py-1.5 text-[10px] font-bold text-[#7A1F2B]">الأمان وحماية البيانات</button>
            <button type="button" onClick={() => setCurrentPage('data-export')} className="rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-700">تصدير البيانات</button>
            <button type="button" onClick={() => setCurrentPage('backup')} className="rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-700">النسخ الاحتياطي</button>
            <button type="button" onClick={() => { setCurrentPage('archive'); }} className="rounded-lg bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-700">سجل النشاط</button>
          </div>
        </div>
      ) : null}

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
