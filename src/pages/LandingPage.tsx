import {
  Award,
  Bell,
  Briefcase,
  Calendar,
  ChevronLeft,
  Cloud,
  FileText,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Instagram,
  Phone,
  Receipt,
  Scale,
  Shield,
  TrendingUp,
  Users
} from 'lucide-react';
import { AppLogo } from '../components/AppLogo';
import { AnimatedAppBackground } from '../components/AnimatedAppBackground';
import { TestimonialsSection } from '../components/marketing/TestimonialsSection';
interface LandingPageProps {
  onNavigate: (page: 'login' | 'register-office' | 'register-lawyer') => void;
}

const TRUST_ITEMS = [
  {
    icon: Lock,
    title: 'تشفير للمستندات الحساسة',
    subtitle: 'AES-GCM at Rest',
    desc: 'تشفير تلقائي للعقود والمذكرات والأحكام الحساسة مع روابط تحميل محمية وعزل بيانات لكل مكتب.'
  },
  {
    icon: Cloud,
    title: 'استضافة آمنة على سحابة موثوقة',
    subtitle: 'Secure Cloud Hosting',
    desc: 'بنية سحابية معزولة لكل مكتب مع نسخ احتياطي وتصدير كامل.'
  },
  {
    icon: FileText,
    title: 'تصدير تقارير رسمية PDF',
    subtitle: 'Official PDF Reports',
    desc: 'صدّر بياناتك وتقاريرك بصيغة PDF جاهزة للطباعة والأرشفة.'
  },
  {
    icon: Scale,
    title: 'مصمم لمكاتب المحاماة',
    subtitle: 'Yemen & GCC Legal',
    desc: 'مصمم خصيصاً لمكاتب المحاماة في اليمن والخليج — قضايا، جلسات، سندات.'
  }
];

const DEMO_MODULES = [
  {
    title: 'لوحة القضايا',
    desc: 'نظرة شاملة على جميع القضايا النشطة والمؤرشفة.',
    icon: Briefcase,
    accent: 'from-amber-500/20 to-amber-600/5',
    mock: (
      <div className="space-y-2 p-3">
        {['قضية تجارية — صنعاء', 'أحوال شخصية — عدن', 'عمالية — تعز'].map((c, i) => (
          <div key={c} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-[10px] shadow-sm border border-slate-100">
            <span className="font-bold text-slate-700 truncate">{c}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${i === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
              {i === 0 ? 'نشطة' : 'مجدولة'}
            </span>
          </div>
        ))}
      </div>
    )
  },
  {
    title: 'تفاصيل القضية',
    desc: 'ملف موحّد للعميل، المحامي، المرحلة، والمبالغ.',
    icon: Scale,
    accent: 'from-indigo-500/20 to-indigo-600/5',
    mock: (
      <div className="p-3 space-y-2">
        <div className="rounded-lg bg-white p-3 border border-slate-100 shadow-sm text-[10px]">
          <p className="font-black text-slate-800">قضية مدنية — موكل: شركة الأمل</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded bg-slate-50 p-2"><span className="text-slate-400 block">الأتعاب</span><span className="font-bold">450,000 ر.ي</span></div>
            <div className="rounded bg-slate-50 p-2"><span className="text-slate-400 block">المتبقي</span><span className="font-bold text-rose-600">120,000</span></div>
          </div>
        </div>
      </div>
    )
  },
  {
    title: 'الجلسات',
    desc: 'جدولة وتذكير بالجلسات والمحاكم.',
    icon: Calendar,
    accent: 'from-emerald-500/20 to-emerald-600/5',
    mock: (
      <div className="p-3 space-y-2">
        {[
          { court: 'محكمة استئناف صنعاء', date: '18 يونيو — 09:00' },
          { court: 'محكمة ابتدائية عدن', date: '22 يونيو — 10:30' }
        ].map((s) => (
          <div key={s.court} className="flex gap-2 rounded-lg bg-white p-2 border border-slate-100 shadow-sm text-[10px]">
            <div className="w-1 rounded-full bg-emerald-500 shrink-0" />
            <div>
              <p className="font-bold text-slate-800">{s.court}</p>
              <p className="text-slate-400">{s.date}</p>
            </div>
          </div>
        ))}
      </div>
    )
  },
  {
    title: 'المدفوعات',
    desc: 'تتبع التحصيلات وسندات القبض.',
    icon: Receipt,
    accent: 'from-rose-500/20 to-rose-600/5',
    mock: (
      <div className="p-3">
        <div className="rounded-lg bg-white border border-slate-100 shadow-sm overflow-hidden text-[10px]">
          <div className="bg-[#7A1F2B] text-white px-3 py-1.5 font-bold">سند قبض — RV-2026-00042</div>
          <div className="p-3 space-y-1">
            <div className="flex justify-between"><span className="text-slate-400">المبلغ</span><span className="font-black">75,000 ر.ي</span></div>
            <div className="flex justify-between"><span className="text-slate-400">الطريقة</span><span className="font-bold">تحويل بنكي</span></div>
          </div>
        </div>
      </div>
    )
  },
  {
    title: 'الملفات',
    desc: 'رفع وتشفير المستندات القانونية.',
    icon: FileText,
    accent: 'from-slate-500/20 to-slate-600/5',
    mock: (
      <div className="p-3 space-y-2">
        {['عقد_الموكل.pdf', 'مذكرة_دفاع.docx', 'حكم_ابتدائي.pdf'].map((f) => (
          <div key={f} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 border border-slate-100 shadow-sm text-[10px]">
            <FileText className="h-3.5 w-3.5 text-[#7A1F2B] shrink-0" />
            <span className="font-bold text-slate-700 truncate">{f}</span>
            <Lock className="h-3 w-3 text-emerald-600 mr-auto shrink-0" />
          </div>
        ))}
      </div>
    )
  }
];

export function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <div className="relative min-h-screen bg-white text-slate-900" dir="rtl">
      <AnimatedAppBackground variant="landing" />
      {/* ─── Header ─── */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#7A1F2B]/95 backdrop-blur-md relative">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-8 lg:px-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <AppLogo variant="law" size="md" tone="inverted" className="shrink-0 shadow-lg shadow-black/10" />
            <div className="leading-tight text-right min-w-0">
              <span className="block font-black text-lg sm:text-xl tracking-tight text-white truncate">LegalMind</span>
              <span className="block text-[10px] sm:text-[11px] text-white/75 font-semibold">نظام إدارة مكاتب المحاماة</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="hidden sm:inline-flex text-white/90 hover:bg-white/10 text-xs sm:text-sm font-bold px-3 py-2 rounded-xl transition-all"
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              onClick={() => onNavigate('register-office')}
              className="bg-white hover:bg-white/90 text-[#7A1F2B] font-black text-xs sm:text-sm px-4 py-2.5 sm:px-5 sm:py-2.5 rounded-xl shadow-lg transition-all"
            >
              ابدأ مجاناً
            </button>
          </div>
        </div>
      </header>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#7A1F2B] via-[#641923] to-[#4A1520] text-white">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-white/5 blur-3xl" />
          <div className="absolute bottom-0 left-0 h-96 w-96 rounded-full bg-amber-500/5 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
          <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-14">
            <div className="space-y-6 text-center lg:col-span-7 lg:text-right">
              <div className="flex flex-wrap items-center justify-center gap-2 lg:justify-start">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] sm:text-xs font-bold backdrop-blur">
                  <Award className="h-3.5 w-3.5 text-amber-300" />
                  النظام رقم 1 لإدارة مكاتب المحاماة الناشئة
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 px-3 py-1 text-[10px] sm:text-xs font-bold text-emerald-100">
                  ⚖️ موثوق من مكاتب يمنية
                </span>
              </div>

              <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl md:text-5xl lg:text-[3.25rem] lg:leading-[1.15]">
                أدر مكتب المحاماة الخاص بك
                <span className="mt-1 block text-white/95">بذكاء وسرية مطلقة</span>
              </h1>

              <p className="mx-auto max-w-xl rounded-2xl border border-amber-400/30 bg-amber-500/15 px-4 py-3 text-sm font-black leading-relaxed text-amber-50 sm:text-base lg:mx-0 lg:inline-block lg:max-w-none">
                📈 وفر أكثر من <span className="text-amber-300 text-lg sm:text-xl">70%</span> من وقت إدارة القضايا، الجلسات، والفواتير
              </p>

              <p className="mx-auto max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base lg:mx-0">
                نظام SaaS قانوني متكامل — قضايا، عملاء، جلسات، مدفوعات، ومستندات مشفرة في منصة واحدة.
              </p>

              {/* CTA */}
              <div className="flex flex-col items-stretch gap-3 pt-2 sm:items-center lg:items-start">
                <button
                  type="button"
                  onClick={() => onNavigate('register-office')}
                  className="group flex w-full sm:w-auto items-center justify-center gap-2 rounded-2xl bg-white px-8 py-4 text-base font-black text-[#7A1F2B] shadow-2xl shadow-black/20 transition-all hover:bg-amber-50 hover:scale-[1.02] active:scale-[0.98] sm:min-w-[280px]"
                >
                  👉 ابدأ تجربة مجانية
                  <ChevronLeft className="h-5 w-5 transition-transform group-hover:-translate-x-1" />
                </button>
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-3 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => onNavigate('login')}
                    className="w-full sm:w-auto rounded-xl border-2 border-white/30 bg-transparent px-6 py-3.5 text-sm font-bold text-white transition-all hover:bg-white/10 sm:min-w-[160px]"
                  >
                    تسجيل الدخول
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('register-lawyer')}
                    className="w-full sm:w-auto rounded-xl border-2 border-white/20 bg-white/5 px-6 py-3.5 text-sm font-bold text-white/90 transition-all hover:bg-white/10 sm:min-w-[160px]"
                  >
                    إنشاء حساب
                  </button>
                </div>
              </div>

              {/* Stats counter */}
              <div className="grid grid-cols-3 gap-3 pt-4 max-w-lg mx-auto lg:mx-0">
                {[
                  { value: '1,200+', label: 'قضية مُدارة' },
                  { value: '85+', label: 'مكتب نشط' },
                  { value: '99.9%', label: 'جاهزية النظام' }
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-white/10 bg-white/5 px-2 py-3 text-center backdrop-blur sm:px-3">
                    <p className="text-lg sm:text-xl font-black text-white font-mono">{s.value}</p>
                    <p className="text-[9px] sm:text-[10px] font-bold text-white/60 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Dashboard preview */}
            <div className="lg:col-span-5">
              <div className="relative mx-auto max-w-md lg:max-w-none">
                <div className="absolute inset-0 rotate-2 rounded-3xl bg-white/10 blur-2xl" />
                <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur-xl sm:p-6">
                  <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
                    <div className="flex gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    </div>
                    <span className="text-[9px] font-mono text-white/60">LegalMind Dashboard</span>
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
                      <div className="mb-2 flex justify-between text-[10px] text-white/70">
                        <span>نسبة إنجاز القضايا</span>
                        <span className="font-bold text-white">87%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/10">
                        <div className="h-full w-[87%] rounded-full bg-gradient-to-l from-amber-400 to-amber-500" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      <div className="rounded-2xl border border-white/10 bg-white/10 p-3 sm:p-4">
                        <Calendar className="mb-2 h-4 w-4 text-amber-300" />
                        <p className="text-[10px] text-white/60">جلسات اليوم</p>
                        <p className="text-lg font-black">3</p>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-white/10 p-3 sm:p-4">
                        <Users className="mb-2 h-4 w-4 text-indigo-300" />
                        <p className="text-[10px] text-white/60">عملاء نشطون</p>
                        <p className="text-lg font-black">48</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Trust Guide ─── */}
      <section className="border-b border-slate-100 bg-slate-50 py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-10">
          <div className="mb-8 text-center sm:mb-10">
            <p className="text-xs font-black uppercase tracking-widest text-[#7A1F2B]">دليل الثقة</p>
            <h2 className="mt-2 text-2xl font-black text-slate-900 sm:text-3xl">لماذا تثق بـ LegalMind؟</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-5">
            {TRUST_ITEMS.map(({ icon: Icon, title, subtitle, desc }) => (
              <div
                key={title}
                className="group rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:border-[#7A1F2B]/20 hover:shadow-md sm:p-6"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#7A1F2B]/8 text-[#7A1F2B] transition-colors group-hover:bg-[#7A1F2B] group-hover:text-white">
                  <Icon className="h-6 w-6" />
                </div>
                <h3 className="text-sm font-black text-slate-900 sm:text-base">{title}</h3>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{subtitle}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How it works (Demo) ─── */}
      <section className="py-14 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-10">
          <div className="mb-10 text-center sm:mb-14">
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-800">
              👉 كيف يعمل النظام
            </span>
            <h2 className="mt-3 text-2xl font-black text-slate-900 sm:text-3xl md:text-4xl">
              كل ما يحتاجه مكتبك في واجهة واحدة
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm text-slate-500">
              من فتح القضية إلى تحصيل الأتعاب — مسار عمل واضح ومصمم للمحامين.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {DEMO_MODULES.map(({ title, desc, icon: Icon, accent, mock }) => (
              <div
                key={title}
                className="flex flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
              >
                <div className={`bg-gradient-to-br ${accent} px-4 pt-4 pb-2`}>
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm text-[#7A1F2B]">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="text-sm font-black text-slate-900">{title}</h3>
                  </div>
                  <p className="text-[11px] leading-relaxed text-slate-500 pb-2">{desc}</p>
                </div>
                <div className="flex-1 bg-slate-50/80">{mock}</div>
              </div>
            ))}
          </div>

          <div className="mt-10 text-center">
            <button
              type="button"
              onClick={() => onNavigate('register-office')}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#7A1F2B] px-8 py-4 text-sm font-black text-white shadow-lg shadow-[#7A1F2B]/25 transition-all hover:bg-[#641923] hover:shadow-xl sm:text-base"
            >
              جرّب النظام مجاناً الآن
              <ChevronLeft className="h-5 w-5" />
            </button>
          </div>
        </div>
      </section>

      <TestimonialsSection />

      {/* ─── Features ─── */}
      <section className="bg-gradient-to-b from-[#641923] to-[#3F1118] py-16 sm:py-24 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-10">
          <div className="mb-10 max-w-3xl space-y-3 text-center mx-auto sm:mb-14">
            <h2 className="text-2xl font-black sm:text-3xl">لماذا يعتمد المحامون على LegalMind؟</h2>
            <p className="text-sm leading-relaxed text-white/75">
              بُني بالتشاور مع خبراء قانونيين في اليمن والخليج — يطابق طبيعة المحاكمات والتوثيقات.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:gap-6">
            {[
              { title: 'إدارة ملفات القضايا', desc: 'تنظيم القضايا والمذكرات مع ربط تلقائي بالعميل والمحامي.', icon: Briefcase },
              { title: 'أجندة الجلسات الذكية', desc: 'تنبيهات لكل جلسة ومحكمة في عموم المحافظات.', icon: Calendar },
              { title: 'خزانة سحابة آمنة', desc: 'رفع العرائض والمذكرات بتشفير وحماية كاملة.', icon: FileText },
              { title: 'صلاحيات الفريق', desc: 'توزيع الأدوار بين الشريك والمحامي والمتدرب.', icon: Shield },
              { title: 'تقارير مالية PDF', desc: 'تحليل الإيرادات والمدفوعات مع تصدير رسمي.', icon: TrendingUp },
              { title: 'تنبيهات فورية', desc: 'لا تفوت جلسة أو موعد تقديم مذكرة.', icon: Bell }
            ].map(({ title, desc, icon: Icon }) => (
              <div
                key={title}
                className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur transition-all hover:bg-white/10 sm:p-6"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-2 text-base font-black sm:text-lg">{title}</h3>
                <p className="text-xs leading-relaxed text-white/70">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="bg-white py-14 sm:py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-8">
          <h2 className="text-2xl font-black text-slate-900 sm:text-3xl">جاهز لتحويل مكتبك إلى مكتب رقمي؟</h2>
          <p className="mt-3 text-sm text-slate-500">ابدأ تجربتك المجانية — بدون بطاقة ائتمان.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => onNavigate('register-office')}
              className="rounded-2xl bg-[#7A1F2B] px-8 py-4 text-base font-black text-white shadow-lg transition-all hover:bg-[#641923]"
            >
              👉 ابدأ تجربة مجانية
            </button>
            <button
              type="button"
              onClick={() => onNavigate('login')}
              className="rounded-2xl border-2 border-slate-200 px-8 py-4 text-base font-bold text-slate-700 transition-all hover:bg-slate-50"
            >
              لدي حساب — تسجيل الدخول
            </button>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-white/10 bg-neutral-950 pt-12 sm:pt-14" dir="rtl">
        <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-10">
          <div className="grid grid-cols-1 gap-8 pb-10 text-right sm:grid-cols-2 md:grid-cols-3 md:gap-10">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-white/10 p-2.5 text-white">
                  <Scale className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">LegalMind Yemen</h3>
                  <p className="text-xs text-white/60">نظام إدارة مكاتب المحاماة</p>
                </div>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-white/65">
                منصة SaaS قانونية احترافية — قضايا، عملاء، جلسات، ومستندات بأمان وثقة.
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-base font-black text-white">تواصل معنا</h3>
              <div className="space-y-3 text-sm">
                <a href="tel:+201152997944" className="group flex items-center gap-3 text-white/75 transition-colors hover:text-white">
                  <Phone className="h-4 w-4 text-white/45 group-hover:text-indigo-400" />
                  <span>رقم الهاتف: <span dir="ltr" className="font-mono">+201152997944</span></span>
                </a>
                <a href="https://wa.me/201152997944" target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 text-white/75 transition-colors hover:text-green-400">
                  <MessageCircle className="h-4 w-4 text-white/45 group-hover:text-green-400" />
                  <span>واتساب: <span dir="ltr" className="font-mono">+201152997944</span></span>
                </a>
                <a href="mailto:legalmind.yemen@gmail.com" className="group flex items-center gap-3 text-white/75 transition-colors hover:text-indigo-400">
                  <Mail className="h-4 w-4 text-white/45 group-hover:text-indigo-400" />
                  <span>البريد: <span dir="ltr">legalmind.yemen@gmail.com</span></span>
                </a>
              </div>
            </div>

            <div className="space-y-4 sm:col-span-2 md:col-span-1">
              <h3 className="text-base font-black text-white">معلومات إضافية</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3 text-white/75">
                  <MapPin className="h-4 w-4 text-white/45" />
                  <span>الجمهورية اليمنية — الخليج العربي</span>
                </div>
                <a href="https://www.instagram.com/7is.al" target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 text-white/75 transition-colors hover:text-pink-400">
                  <Instagram className="h-4 w-4 text-white/45 group-hover:text-pink-400" />
                  <span>انستغرام: <span dir="ltr" className="font-mono">7is.al</span></span>
                </a>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 py-5 text-center">
            <p className="text-xs text-white/55">© ٢٠٢٦ LegalMind Yemen. جميع الحقوق محفوظة.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
