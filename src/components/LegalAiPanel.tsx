import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Loader2,
  Scale,
  ScrollText,
  Sparkles,
  Upload
} from 'lucide-react';
import { RichTextContent } from './ui/RichTextEditor';
import {
  callLegalAi,
  CONTRACT_TYPES,
  readTextFromFile,
  type LegalAiAction
} from '../lib/legalAi';
import { sanitizeHtml } from '../lib/sanitizeHtml';

type TabId = LegalAiAction;

const TABS: Array<{ id: TabId; label: string; icon: typeof FileText; desc: string }> = [
  { id: 'summarize', label: 'تلخيص مستندات', icon: FileText, desc: 'لخص مذكرات وعقود ومراسلات' },
  { id: 'contract_draft', label: 'مسودات عقود', icon: ScrollText, desc: 'أنشئ مسودة عقد للمراجعة' },
  { id: 'legal_research', label: 'بحث قانوني', icon: Scale, desc: 'استفسارات في القانون اليمني' }
];

export interface LegalAiPanelProps {
  /** Smaller header when embedded in documents page */
  embedded?: boolean;
  defaultTab?: TabId;
  initialDocText?: string;
  initialDocTitle?: string;
}

function ResultPanel({ result, onCopy }: { result: string; onCopy: () => void }) {
  const html = sanitizeHtml(result.replace(/\n/g, '<br/>'));
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 overflow-hidden">
      <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-2.5">
        <span className="text-xs font-black text-emerald-800">النتيجة</span>
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-800 shadow-sm hover:bg-emerald-100"
        >
          <Copy className="h-3 w-3" />
          نسخ
        </button>
      </div>
      <div className="max-h-[420px] overflow-y-auto p-4 text-sm leading-relaxed text-slate-800">
        <RichTextContent html={html} />
      </div>
    </div>
  );
}

export function LegalAiPanel({
  embedded = false,
  defaultTab = 'summarize',
  initialDocText = '',
  initialDocTitle
}: LegalAiPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [tab, setTab] = useState<TabId>(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [docText, setDocText] = useState(initialDocText);
  const [contractType, setContractType] = useState<string>(CONTRACT_TYPES[0]);
  const [firstParty, setFirstParty] = useState('');
  const [secondParty, setSecondParty] = useState('');
  const [subject, setSubject] = useState('');
  const [amount, setAmount] = useState('');
  const [duration, setDuration] = useState('');
  const [specialTerms, setSpecialTerms] = useState('');
  const [jurisdiction, setJurisdiction] = useState('الجمهورية اليمنية');
  const [query, setQuery] = useState('');

  useEffect(() => {
    setTab(defaultTab);
    setExpanded(true);
  }, [defaultTab]);

  useEffect(() => {
    if (initialDocText) {
      setDocText(initialDocText);
      setTab('summarize');
      setExpanded(true);
      setResult(null);
      setError(null);
    }
  }, [initialDocText]);

  const handleFileUpload = useCallback(async (file: File) => {
    setError(null);
    try {
      setDocText(await readTextFromFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر قراءة الملف');
    }
  }, []);

  const runAction = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let response;
      if (tab === 'summarize') {
        response = await callLegalAi({ action: 'summarize', text: docText });
      } else if (tab === 'contract_draft') {
        response = await callLegalAi({
          action: 'contract_draft',
          contractType,
          firstParty: firstParty || 'الطرف الأول',
          secondParty: secondParty || 'الطرف الثاني',
          subject,
          amount: amount || undefined,
          duration: duration || undefined,
          specialTerms: specialTerms || undefined,
          jurisdiction
        });
      } else {
        response = await callLegalAi({ action: 'legal_research', query });
      }
      setResult(response.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div
        className={`overflow-hidden rounded-2xl border shadow-sm ${
          embedded
            ? 'border-[#7A1F2B]/20 bg-gradient-to-l from-[#7A1F2B] via-[#8B2433] to-indigo-950 text-white'
            : 'border-slate-200 bg-gradient-to-l from-[#7A1F2B] via-[#8B2433] to-indigo-950 p-6 text-white shadow-xl'
        }`}
      >
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between gap-3 p-4 text-right sm:p-5"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-xl border border-white/15 bg-white/10 p-2 shrink-0">
              <Sparkles className="h-5 w-5 text-amber-200" />
            </div>
            <div className="min-w-0">
              <h2 className={`font-black ${embedded ? 'text-base' : 'text-2xl'}`}>المساعد القانوني الذكي</h2>
              <p className="mt-0.5 text-[10px] sm:text-xs text-white/75 truncate">
                تلخيص · مسودات عقود · بحث قانوني
              </p>
            </div>
          </div>
          {expanded ? <ChevronUp className="h-5 w-5 shrink-0 opacity-80" /> : <ChevronDown className="h-5 w-5 shrink-0 opacity-80" />}
        </button>
        {!embedded && (
          <div className="hidden sm:block px-6 pb-4">
            <Bot className="h-8 w-8 text-amber-200/80" />
          </div>
        )}
      </div>

      {expanded ? (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTab(t.id);
                    setError(null);
                    setResult(null);
                  }}
                  className={`rounded-xl border p-3 text-right transition-all ${
                    active ? 'border-[#7A1F2B] bg-[#FFF9FA] shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <Icon className={`mb-1.5 h-5 w-5 ${active ? 'text-[#7A1F2B]' : 'text-slate-400'}`} />
                  <p className="text-xs font-black text-slate-900">{t.label}</p>
                  <p className="mt-0.5 text-[10px] text-slate-500">{t.desc}</p>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            {tab === 'summarize' && (
              <>
                {initialDocTitle ? (
                  <p className="text-[11px] font-bold text-indigo-700">المستند: {initialDocTitle}</p>
                ) : null}
                <label className="block text-xs font-bold text-slate-700">نص المستند</label>
                <textarea
                  value={docText}
                  onChange={(e) => setDocText(e.target.value)}
                  rows={8}
                  placeholder="الصق نص المذكرة أو العقد هنا..."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-[#7A1F2B] focus:ring-2 focus:ring-[#7A1F2B]/10"
                />
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <Upload className="h-4 w-4" />
                  رفع ملف نصي (.txt / .md)
                  <input
                    type="file"
                    accept=".txt,.md,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFileUpload(f);
                      e.target.value = '';
                    }}
                  />
                </label>
              </>
            )}

            {tab === 'contract_draft' && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">نوع العقد</label>
                  <select value={contractType} onChange={(e) => setContractType(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
                    {CONTRACT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">الطرف الأول</label>
                  <input value={firstParty} onChange={(e) => setFirstParty(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="الموكل / الشركة" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">الطرف الثاني</label>
                  <input value={secondParty} onChange={(e) => setSecondParty(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="الطرف الآخر" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">موضوع العقد *</label>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="مثال: تمثيل قانوني في قضية تجارية" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">المبلغ / القيمة</label>
                  <input value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="اختياري" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">المدة</label>
                  <input value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" placeholder="مثال: سنة" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">شروط خاصة</label>
                  <textarea value={specialTerms} onChange={(e) => setSpecialTerms(e.target.value)} rows={3} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-bold text-slate-700">الاختصاص القضائي</label>
                  <input value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm" />
                </div>
              </div>
            )}

            {tab === 'legal_research' && (
              <>
                <label className="block text-xs font-bold text-slate-700">موضوع البحث أو السؤال</label>
                <textarea
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  rows={6}
                  placeholder="مثال: ما إجراءات رفع دعوى تعويض في القانون اليمني؟"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#7A1F2B] focus:ring-2 focus:ring-[#7A1F2B]/10"
                />
              </>
            )}

            {error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>
            ) : null}

            <button
              type="button"
              disabled={loading}
              onClick={() => void runAction()}
              className="inline-flex items-center gap-2 rounded-xl bg-[#7A1F2B] px-6 py-2.5 text-xs font-black text-white hover:bg-[#641923] disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {loading ? 'جاري المعالجة...' : tab === 'summarize' ? 'تلخيص المستند' : tab === 'contract_draft' ? 'إنشاء مسودة العقد' : 'بدء البحث القانوني'}
            </button>
          </div>

          {result ? <ResultPanel result={result} onCopy={() => void copyResult()} /> : null}

          <p className="text-[10px] leading-relaxed text-slate-400">
            المخرجات مسودات للمراجعة من محامٍ مرخّص. تأكد من نشر دالة legal-ai وإضافة OPENAI_API_KEY في Supabase.
          </p>
        </>
      ) : null}
    </div>
  );
}
