import { Award, Briefcase, Calendar, Bell, FileText, Shield, TrendingUp, Scale, LogIn, UserPlus, Building2, Phone, Mail, MapPin, MessageCircle, Instagram } from 'lucide-react';
import { AppLogo } from '../components/AppLogo';

interface LandingPageProps {
  onNavigate: (page: 'login' | 'register-office' | 'register-lawyer') => void;
}

export function LandingPage({ onNavigate }: LandingPageProps) {
  const actionCards = [
    {
      title: 'تسجيل مكتب',
      desc: 'ابدأ مساحة عمل قانونية جديدة وأدر فريقك وقضاياك باحتراف.',
      icon: Building2,
      action: () => onNavigate('register-office'),
      primary: true
    },
    {
      title: 'إنشاء حساب',
      desc: 'انضم إلى مكتبك عبر كود المكتب وابدأ إدارة ملفاتك القانونية.',
      icon: UserPlus,
      action: () => onNavigate('register-lawyer')
    },
    {
      title: 'دخول النظام',
      desc: 'سجّل الدخول كمدير أو محامٍ أو مساعد حسب صلاحيتك.',
      icon: LogIn,
      action: () => onNavigate('login')
    }
  ];

  return (
    <div className="bg-gradient-to-b from-[#7A1F2B] via-[#641923] to-[#3F1118] text-white min-h-screen">
      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-10 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AppLogo variant="law" size="lg" tone="inverted" className="shadow-lg shadow-black/10" />
          <div className="leading-tight text-right">
            <span className="font-extrabold text-2xl tracking-tight !text-white">LegalMind</span>
            <span className="block text-[11px] !text-white/80 font-semibold mt-0.5">نظام إدارة مكاتب المحاماة</span>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="!text-white hover:bg-white/10 text-sm font-bold px-4 py-2 rounded-xl transition-all duration-300"
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            onClick={() => onNavigate('register-lawyer')}
            className="border border-white/20 !text-white hover:bg-white/10 font-bold text-sm px-5 py-2 rounded-xl transition-all duration-300"
          >
            إنشاء حساب محامي
          </button>
          <button
            type="button"
            onClick={() => onNavigate('register-office')}
            className="bg-white hover:bg-white/90 text-[#7A1F2B] font-bold text-sm px-5 py-2 rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl"
          >
            تسجيل مكتب محاماة
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-10 pt-12 pb-24 text-center md:text-right grid grid-cols-1 md:grid-cols-12 gap-12 items-center">
        <div className="md:col-span-7 space-y-7">
          <span className="inline-flex items-center gap-1.5 bg-white/10 backdrop-blur border border-white/15 !text-white px-4 py-1.5 rounded-full text-xs font-bold">
            <Award className="w-3.5 h-3.5" />
            المنصة الرقمية الأولى للمحاماة في اليمن لعام 2026
          </span>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black leading-tight tracking-tight !text-white">
            أدر مكتب المحاماة الخاص بك <br />
            <span className="!text-white">بذكاء وسرية مطلقة</span>
          </h1>
          <p className="text-base sm:text-lg !text-white/85 max-w-2xl leading-relaxed tracking-wide">
            نظام حوسبة قانوني متكامل يمني الطابع؛ يُنظم لك القضايا والعملاء، ويجدول الجلسات والمرافعات، ويحفظ المستندات بسحابة آمنة، لتتفرغ لتطبيق العدالة وصناعة الفارق.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            {actionCards.map((card) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.title}
                  type="button"
                  onClick={card.action}
                  className={`group text-right rounded-2xl p-5 shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300 border backdrop-blur ${
                    card.primary
                      ? 'bg-white text-[#7A1F2B] border-white/60'
                      : 'bg-white/10 !text-white border-white/15 hover:bg-white/15'
                  }`}
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-105 ${card.primary ? 'bg-[#7A1F2B] text-white' : 'bg-white/10 text-white'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className={`text-base font-black mb-1 ${card.primary ? 'text-[#7A1F2B]' : '!text-white'}`}>{card.title}</div>
                  <p className={`text-xs leading-relaxed ${card.primary ? 'text-[#6B7280]' : '!text-white/75'}`}>{card.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-5 relative">
          <div className="absolute inset-0 bg-white/10 rounded-3xl rotate-3 opacity-70 blur-xl" />
          <div className="relative bg-white/10 backdrop-blur-xl border border-white/15 p-6 rounded-3xl shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-500" />
                <span className="w-3 h-3 rounded-full bg-[#D97706]" />
                <span className="w-3 h-3 rounded-full bg-emerald-500" />
              </div>
              <span className="text-[10px] !text-white/70 font-mono">لوحة التحكم القانونية - نسخة تجريبية</span>
            </div>
            <div className="space-y-4">
              <div className="bg-white/10 p-4 rounded-2xl border border-white/10 text-right shadow-lg">
                <div className="flex justify-between text-xs !text-white/75 mb-2">
                  <span>إحصائيات القضايا المنظورة</span>
                  <span className="!text-white font-bold">87% نسبة نجاح الأحكام</span>
                </div>
                <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                  <div className="bg-white h-full w-[87%] rounded-full" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-right">
                <div className="bg-white/10 p-4 rounded-2xl border border-white/10">
                  <span className="text-[11px] !text-white/70 block">الجلسات القادمة اليوم</span>
                  <span className="text-xl font-black !text-white font-sans">3 جلسات</span>
                </div>
                <div className="bg-white/10 p-4 rounded-2xl border border-white/10">
                  <span className="text-[11px] !text-white/70 block">العملاء النشطون بالمكتب</span>
                  <span className="text-xl font-black text-white font-sans">4 عملاء</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#641923] py-24 border-t border-white/10">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-10">
          <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
            <h2 className="text-3xl font-black !text-white">لماذا يعتمد المحامون اليمنيون على LegalMind؟</h2>
            <p className="!text-white/75 text-sm leading-relaxed">تم بناء منصتنا بالتشاور مع خبراء قانونيين وقضاة في اليمن لتطابق طبيعة المحاكمات والتوثيقات وإدارة مكاتب المحاماة بشكل مثالي.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-right">
            {[
              { title: 'إدارة ملفات القضايا الرقمية', desc: 'تنظيم قضاياك وتاريخ المذكرات مع ربطها التلقائي بالعميل والمحامي الممارس.', icon: Briefcase },
              { title: 'أجندة الجلسات الذكية', desc: 'نظام لتنبيهك بكل جلسة قادمة ومحكمة الانعقاد في عموم المحافظات.', icon: Calendar },
              { title: 'خزانة سحابة آمنة', desc: 'ارفع العرائض والمذكرات بأمان تام مع تشفير لحظي.', icon: FileText },
              { title: 'صلاحيات الفريق والأدوار', desc: 'وزع الأدوار بين المحامي الشريك والمستشار والمتدرب للحفاظ على السرية.', icon: Shield },
              { title: 'تقارير الأداء المالي', desc: 'احصل على تحليل دقيق للإيرادات والمدفوعات.', icon: TrendingUp },
              { title: 'تنبيهات فورية لحظية', desc: 'لا تفوت جلسة أو موعد تقديم عريضة استئناف.', icon: Bell }
            ].map((feature) => (
              <div key={feature.title} className="bg-white/10 backdrop-blur border border-white/10 p-6 rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
                <div className="bg-white/10 w-12 h-12 rounded-xl flex items-center justify-center text-white mb-4">
                  <feature.icon className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-lg !text-white mb-2">{feature.title}</h3>
                <p className="!text-white/75 text-xs leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="bg-neutral-950 border-t border-white/10 pt-14" dir="rtl">
        <div className="max-w-7xl mx-auto px-5 sm:px-8 lg:px-10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10 text-right pb-10">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="bg-white/10 p-2.5 rounded-2xl text-white">
                  <Scale className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black !text-white">LegalMind Yemen</h3>
                  <p className="text-xs !text-white/60">نظام إدارة مكاتب المحاماة</p>
                </div>
              </div>
              <p className="text-sm !text-white/65 leading-relaxed max-w-sm">
                منصة قانونية احترافية تساعد مكاتب المحاماة على إدارة القضايا، العملاء، الجلسات، والمستندات بمرونة وأمان.
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-base font-black !text-white">تواصل معنا</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3 !text-white/75">
                  <Phone className="w-4 h-4 !text-white/45" />
                  <span>رقم الهاتف: <span dir="ltr" className="font-mono">+201152997944</span></span>
                </div>
                <div className="flex items-center gap-3 !text-white/75">
                  <MessageCircle className="w-4 h-4 !text-white/45" />
                  <span>واتساب: <span dir="ltr" className="font-mono">+201152997944</span></span>
                </div>
                <div className="flex items-center gap-3 !text-white/75">
                  <Mail className="w-4 h-4 !text-white/45" />
                  <span>البريد الإلكتروني: <span dir="ltr">legalmind.yemen@gmail.com</span></span>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-base font-black !text-white">معلومات إضافية</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3 !text-white/75">
                  <MapPin className="w-4 h-4 !text-white/45" />
                  <span>الموقع: الجمهورية اليمنية</span>
                </div>
                <div className="flex items-center gap-3 !text-white/75">
                  <Instagram className="w-4 h-4 !text-white/45" />
                  <span>انستغرام: <span dir="ltr" className="font-mono">7is.al</span></span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 py-5 text-center">
            <p className="text-xs !text-white/55">© ٢٠٢٦ LegalMind Yemen. جميع الحقوق محفوظة.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
