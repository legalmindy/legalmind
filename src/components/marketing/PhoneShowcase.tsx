import { Briefcase, Calendar, FileText, LayoutDashboard, Users } from 'lucide-react';
import type { ReactNode } from 'react';

const SHOWCASES = [
  {
    title: 'لوحة التحكم',
    caption: 'متابعة القضايا والجلسات والعملاء',
    icon: LayoutDashboard,
    screen: (
      <div className="space-y-2 p-3">
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-2.5 text-[9px]">
          <p className="font-black text-emerald-800">الاشتراك نشط</p>
          <p className="text-emerald-600">ينتهي 08-10-2026</p>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { l: 'قضايا نشطة', v: '12' },
            { l: 'عملاء', v: '48' },
            { l: 'جلسات', v: '3' },
            { l: 'مستندات', v: '156' }
          ].map((s) => (
            <div key={s.l} className="rounded-lg bg-white border border-slate-100 p-2 shadow-sm">
              <p className="text-[8px] text-slate-400">{s.l}</p>
              <p className="text-sm font-black text-slate-800">{s.v}</p>
            </div>
          ))}
        </div>
      </div>
    )
  },
  {
    title: 'إدارة القضايا',
    caption: 'فتح وتتبع وأرشفة الملفات',
    icon: Briefcase,
    screen: (
      <div className="space-y-2 p-3">
        <div className="rounded-xl bg-[#7A1F2B] text-white p-2.5 text-[9px] font-bold">+ فتح قضية جديدة</div>
        <div className="rounded-lg bg-white border border-slate-100 p-2 text-[9px] shadow-sm">
          <p className="font-black text-slate-800">قضية تجارية — صنعاء</p>
          <p className="text-slate-400 mt-0.5">موكل: شركة الأمل</p>
        </div>
        <div className="rounded-lg bg-white border border-slate-100 p-2 text-[9px] shadow-sm">
          <p className="font-black text-slate-800">أحوال شخصية — عدن</p>
          <p className="text-slate-400 mt-0.5">جلسة: 18 يونيو</p>
        </div>
      </div>
    )
  },
  {
    title: 'العملاء',
    caption: 'دليل الموكلين والشركات',
    icon: Users,
    screen: (
      <div className="space-y-2 p-3">
        <div className="rounded-xl bg-[#7A1F2B] text-white p-2 text-[9px] font-bold text-center">+ إضافة عميل</div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[8px] text-slate-400">ابحث عن العميل...</div>
        {['أحمد الشامي', 'شركة النور'].map((n) => (
          <div key={n} className="rounded-lg bg-white border border-slate-100 p-2 text-[9px] font-bold text-slate-700 shadow-sm">{n}</div>
        ))}
      </div>
    )
  },
  {
    title: 'الجلسات',
    caption: 'أجندة المحاكم والتذكيرات',
    icon: Calendar,
    screen: (
      <div className="space-y-2 p-3">
        <div className="rounded-xl bg-[#7A1F2B] text-white p-2 text-[9px] font-bold">+ جدولة جلسة</div>
        <div className="rounded-lg bg-white border border-slate-100 p-2 text-[9px] shadow-sm flex justify-between">
          <span className="font-bold">10:30</span>
          <span className="text-slate-500">استئناف</span>
        </div>
      </div>
    )
  },
  {
    title: 'المستندات',
    caption: 'خزانة مشفرة وآمنة',
    icon: FileText,
    screen: (
      <div className="space-y-2 p-3">
        <p className="text-[9px] font-bold text-slate-500">5 مستندات — مرتبة حسب القضية</p>
        <div className="rounded-xl bg-slate-900 text-white p-2 text-[9px] font-bold text-center">+ رفع وثيقة</div>
        {['عقد.pdf', 'مذكرة.docx'].map((f) => (
          <div key={f} className="rounded-lg bg-white border border-slate-100 p-2 text-[9px] font-bold shadow-sm">{f}</div>
        ))}
      </div>
    )
  }
];

function PhoneFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-[200px] sm:w-[220px]">
      <div className="rounded-[2rem] border-[6px] border-slate-800 bg-slate-800 p-1.5 shadow-2xl shadow-slate-900/30">
        <div className="rounded-[1.4rem] overflow-hidden bg-[#7A1F2B]">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="h-2 w-2 rounded-full bg-white/30" />
            <div className="h-4 w-16 rounded-full bg-white/20" />
            <div className="h-5 w-5 rounded-md bg-white flex items-center justify-center">
              <Briefcase className="h-3 w-3 text-[#7A1F2B]" />
            </div>
          </div>
          <div className="bg-slate-100 min-h-[280px]">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function PhoneShowcase() {
  return (
    <section className="py-14 sm:py-20 overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-10">
        <div className="mb-10 text-center">
          <p className="text-xs font-black uppercase tracking-widest text-[#7A1F2B]">معاينة التطبيق</p>
          <h2 className="mt-2 text-2xl font-black text-slate-900 sm:text-3xl">واجهة احترافية — جاهزة للإعلان</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">شاشات حقيقية من النظام — مثالية للتسويق على واتساب وانستغرام</p>
        </div>

        <div className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 sm:overflow-visible">
          {SHOWCASES.map(({ title, caption, icon: Icon, screen }) => (
            <div key={title} className="snap-center shrink-0 sm:shrink">
              <PhoneFrame>{screen}</PhoneFrame>
              <div className="mt-4 text-center">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-[#7A1F2B]/10 px-3 py-1 text-[10px] font-black text-[#7A1F2B]">
                  <Icon className="h-3 w-3" />
                  {title}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">{caption}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
