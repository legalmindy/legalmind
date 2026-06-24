import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, MessageSquarePlus, Star } from 'lucide-react';
import { fetchApprovedTestimonials, submitPublicTestimonial } from '../../lib/testimonialsApi';
import { toArabicQueryError } from '../QueryErrorBanner';

const FALLBACK_TESTIMONIALS = [
  {
    id: 'seed-1',
    authorName: 'أ. محمد الحميري',
    authorRole: 'مدير مكتب — صنعاء',
    body: 'وفّر علينا ساعات يومية في متابعة الجلسات والتحصيلات. النظام عملي جداً لمكتبنا.',
    stars: 5
  },
  {
    id: 'seed-2',
    authorName: 'أ. سارة العولقي',
    authorRole: 'محامية — عدن',
    body: 'أخيراً نظام يفهم طبيعة المحاكم اليمنية. التصدير PDF والأمان أعطانا ثقة كاملة.',
    stars: 5
  },
  {
    id: 'seed-3',
    authorName: 'مكتب الشر partners',
    authorRole: 'مكتب ناشئ — تعز',
    body: 'من أفضل قراراتنا التشغيلية. الفريق يرى فقط ما يخصه — والمالك يرى كل شيء.',
    stars: 5
  }
];

function MiniStars({ count, interactive = false, value = 0, onChange }: { count?: number; interactive?: boolean; value?: number; onChange?: (n: number) => void }) {
  const stars = interactive ? 5 : (count ?? 5);
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: stars }).map((_, i) => {
        const filled = interactive ? i < value : i < (count ?? 5);
        if (interactive) {
          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange?.(i + 1)}
              className="rounded p-0.5 transition-transform hover:scale-110"
              aria-label={`${i + 1} نجوم`}
            >
              <Star className={`h-4 w-4 sm:h-5 sm:w-5 ${filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
            </button>
          );
        }
        return <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />;
      })}
    </div>
  );
}

export function TestimonialsSection() {
  const queryClient = useQueryClient();
  const [authorName, setAuthorName] = useState('');
  const [authorRole, setAuthorRole] = useState('');
  const [body, setBody] = useState('');
  const [stars, setStars] = useState(5);
  const [formOpen, setFormOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const { data: remote = [], isLoading } = useQuery({
    queryKey: ['public-testimonials'],
    queryFn: () => fetchApprovedTestimonials(24),
    staleTime: 60_000
  });

  const testimonials = remote.length > 0 ? remote : FALLBACK_TESTIMONIALS;

  const submitMutation = useMutation({
    mutationFn: submitPublicTestimonial,
    onSuccess: async () => {
      setAuthorName('');
      setAuthorRole('');
      setBody('');
      setStars(5);
      setFormOpen(false);
      setSuccess('شكراً! تم نشر تعليقك بنجاح.');
      await queryClient.invalidateQueries({ queryKey: ['public-testimonials'] });
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess(null);
    submitMutation.mutate({ authorName, authorRole, body, stars });
  };

  return (
    <section className="border-y border-slate-100 bg-slate-50 py-14 sm:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-8 lg:px-10">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-black text-slate-900 sm:text-3xl">ماذا يقول المحامون؟</h2>
          <p className="mt-2 text-sm text-slate-500">تقييمات من مكاتب تستخدم LegalMind</p>
        </div>

        <div className="mb-8 flex justify-center">
          <button
            type="button"
            onClick={() => {
              setFormOpen((v) => !v);
              setSuccess(null);
            }}
            className="inline-flex items-center gap-2 rounded-2xl border-2 border-[#7A1F2B]/20 bg-white px-5 py-3 text-sm font-black text-[#7A1F2B] shadow-sm transition-all hover:border-[#7A1F2B]/40 hover:bg-[#7A1F2B]/5"
          >
            <MessageSquarePlus className="h-4 w-4" />
            {formOpen ? 'إخفاء النموذج' : 'أضف تعليقك'}
          </button>
        </div>

        {formOpen ? (
          <form
            onSubmit={handleSubmit}
            className="mx-auto mb-10 max-w-2xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
          >
            <h3 className="mb-4 text-sm font-black text-slate-800">شارك تجربتك مع LegalMind</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">الاسم</label>
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={authorName}
                  onChange={(e) => setAuthorName(e.target.value)}
                  placeholder="مثال: أ. أحمد الشامي"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">المسمى / المكتب</label>
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={authorRole}
                  onChange={(e) => setAuthorRole(e.target.value)}
                  placeholder="مثال: محامٍ — صنعاء"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-bold text-slate-500">تقييمك</label>
              <MiniStars interactive value={stars} onChange={setStars} />
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-xs font-bold text-slate-500">تعليقك</label>
              <textarea
                required
                minLength={10}
                maxLength={600}
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="اكتب تجربتك مع النظام..."
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B]"
              />
              <p className="mt-1 text-[10px] text-slate-400">{body.length}/600</p>
            </div>

            {submitMutation.error ? (
              <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">
                {toArabicQueryError(submitMutation.error, 'إرسال التعليق')}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitMutation.isPending}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#7A1F2B] px-5 py-3 text-sm font-black text-white disabled:opacity-60 sm:w-auto"
            >
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              نشر التعليق
            </button>
          </form>
        ) : null}

        {success ? (
          <p className="mx-auto mb-8 max-w-2xl rounded-xl bg-emerald-50 px-4 py-3 text-center text-xs font-bold text-emerald-800">
            {success}
          </p>
        ) : null}

        {isLoading ? (
          <div className="flex justify-center py-8 text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
            {testimonials.map((t) => (
              <div key={t.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <MiniStars count={t.stars} />
                <p className="mt-4 text-sm leading-relaxed text-slate-600">&ldquo;{t.body}&rdquo;</p>
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-sm font-black text-slate-900">{t.authorName}</p>
                  <p className="text-xs text-slate-400">{t.authorRole}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
