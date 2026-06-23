import {
  Database,
  Download,
  HardDrive,
  History,
  Lock,
  Shield,
  ShieldCheck,
  Users
} from 'lucide-react';
import type { PageId } from '../types/app';

interface TrustSecurityPageProps {
  onNavigate?: (page: PageId) => void;
}

const FEATURES = [
  {
    icon: Database,
    title: 'البيانات ملك للعميل',
    description: 'جميع البيانات المدخلة داخل النظام هي ملك للعميل بشكل كامل، ويمكن تصديرها أو طلب نسخة كاملة منها في أي وقت.'
  },
  {
    icon: Download,
    title: 'إمكانية التصدير الكامل',
    description: 'تصدير العملاء والقضايا والجلسات والمدفوعات والسندات والمصروفات والموظفين والملفات بصيغ Excel و CSV و ZIP.'
  },
  {
    icon: HardDrive,
    title: 'النسخ الاحتياطي',
    description: 'إنشاء نسخ احتياطية دورية تحتوي على جميع الجداول والملفات والإعدادات مع سجل بالتاريخ والحجم والمستخدم.'
  },
  {
    icon: Lock,
    title: 'تشفير الملفات الحساسة',
    description: 'العقود والمذكرات والأحكام والوثائق القانونية تُخزَّن مشفّرة بمفتاح خاص بالمكتب مع روابط محمية ومنع الوصول المباشر.'
  },
  {
    icon: History,
    title: 'سجل التدقيق',
    description: 'تسجيل كامل لعمليات الإنشاء والتعديل والحذف وتسجيل الدخول والخروج مع المستخدم والتاريخ وعنوان IP.'
  },
  {
    icon: Users,
    title: 'عزل بيانات المكاتب',
    description: 'كل مكتب يرى بياناته فقط — لا يمكن الوصول إلى قضايا أو عملاء أو ملفات أو مدفوعات المكاتب الأخرى.'
  }
];

export function TrustSecurityPage({ onNavigate }: TrustSecurityPageProps) {
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6" dir="rtl">
      <div className="overflow-hidden rounded-3xl bg-gradient-to-l from-slate-950 via-[#7A1F2B] to-indigo-950 p-8 text-white shadow-xl">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-white/10 p-4 backdrop-blur">
            <ShieldCheck className="h-10 w-10 text-amber-300" />
          </div>
          <div>
            <h1 className="text-3xl font-black">الأمان وحماية البيانات</h1>
            <p className="mt-2 max-w-2xl text-sm text-white/80">
              LegalMind Yemen مبني لبيئة المحاماة — سرية الموكلين وأمان الملفات القانونية أولوية قصوى.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <div key={title} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#7A1F2B]/10">
              <Icon className="h-5 w-5 text-[#7A1F2B]" />
            </div>
            <h2 className="text-sm font-black text-slate-900">{title}</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{description}</p>
          </div>
        ))}
      </div>

      {onNavigate ? (
        <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-5">
          <p className="w-full text-xs font-bold text-slate-600">أدوات الأمان السريعة</p>
          <button type="button" onClick={() => onNavigate('data-export')} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-[#7A1F2B] shadow-sm border border-slate-100">
            تصدير البيانات
          </button>
          <button type="button" onClick={() => onNavigate('backup')} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-indigo-950 shadow-sm border border-slate-100">
            النسخ الاحتياطي
          </button>
          <button type="button" onClick={() => onNavigate('archive')} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm border border-slate-100">
            سجل النشاط
          </button>
          <button type="button" onClick={() => onNavigate('settings')} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-sm border border-slate-100">
            <Shield className="inline h-3.5 w-3.5 ml-1" /> الإعدادات والأمان
          </button>
        </div>
      ) : null}
    </div>
  );
}
