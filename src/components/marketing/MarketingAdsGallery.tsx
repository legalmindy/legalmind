import { Download } from 'lucide-react';

const ADS = [
  {
    src: '/marketing/ad-legalmind-dashboard.png',
    title: 'إعلان ستوري — لوحة التحكم',
    desc: '1080×1920 — واتساب / انستغرام',
    filename: 'legalmind-story-dashboard.png'
  },
  {
    src: '/marketing/ad-legalmind-features.png',
    title: 'إعلان مربع — ميزات النظام',
    desc: '1080×1080 — منشورات السوشيال',
    filename: 'legalmind-features-square.png'
  },
  {
    src: '/marketing/ad-legalmind-banner.png',
    title: 'بانر أفقي — تجربة مجانية',
    desc: '1200×628 — فيسبوك / لينكدإن',
    filename: 'legalmind-banner-wide.png'
  }
];

export function MarketingAdsGallery() {
  return (
    <section className="border-t border-slate-100 bg-gradient-to-b from-slate-50 to-white py-14 sm:py-16">
      <div className="mx-auto max-w-6xl px-4 sm:px-8 lg:px-10">
        <div className="mb-8 text-center">
          <p className="text-xs font-black uppercase tracking-widest text-[#7A1F2B]">مواد تسويقية جاهزة</p>
          <h2 className="mt-2 text-2xl font-black text-slate-900 sm:text-3xl">صور الإعلان — حمّل وانشر</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">تصاميم احترافية جاهزة للنشر على واتساب وانستغرام وفيسبوك</p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {ADS.map((ad) => (
            <div key={ad.src} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:shadow-lg">
              <div className="aspect-[4/5] bg-slate-100 md:aspect-auto md:h-64 overflow-hidden">
                <img src={ad.src} alt={ad.title} className="h-full w-full object-cover object-top" loading="lazy" />
              </div>
              <div className="p-4 space-y-2">
                <h3 className="text-sm font-black text-slate-900">{ad.title}</h3>
                <p className="text-xs text-slate-500">{ad.desc}</p>
                <a
                  href={ad.src}
                  download={ad.filename}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#7A1F2B] px-4 py-2 text-xs font-bold text-white hover:bg-[#641923] transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  تحميل الصورة
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
