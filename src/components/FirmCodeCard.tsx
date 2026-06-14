import { useCallback, useState } from 'react';
import { Check, Copy, KeyRound, Share2 } from 'lucide-react';
import { normalizeFirmCode } from '../lib/firmCode';

interface FirmCodeCardProps {
  firmCode: string;
  firmName?: string;
  onCopied?: (message: string) => void;
  variant?: 'default' | 'hero' | 'compact' | 'navbar';
}

export function FirmCodeCard({ firmCode, firmName, onCopied, variant = 'default' }: FirmCodeCardProps) {
  const [copied, setCopied] = useState(false);
  const displayCode = normalizeFirmCode(firmCode);
  const [prefix, suffix] = displayCode.includes('-') ? displayCode.split('-') : [displayCode.slice(0, 3), displayCode.slice(3)];

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopied(true);
      onCopied?.('تم نسخ كود المكتب بنجاح.');
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      onCopied?.('تعذر نسخ الكود. حاول يدوياً.');
    }
  }, [displayCode, onCopied]);

  if (variant === 'compact') {
    return (
      <div className="inline-flex items-center gap-2 rounded-xl border border-amber-200/60 bg-amber-50 px-3 py-2" dir="rtl">
        <span className="font-mono text-sm font-black tracking-wider text-slate-900">{displayCode}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded-lg p-1.5 text-amber-800 hover:bg-amber-100 transition-colors"
          aria-label="نسخ كود المكتب"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    );
  }

  if (variant === 'navbar') {
    return (
      <div
        className="hidden xl:flex items-center gap-2 rounded-xl border border-white/15 bg-[#641923] px-3 py-1.5"
        dir="rtl"
      >
        <KeyRound className="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden="true" />
        <div className="text-right leading-tight">
          <p className="text-[9px] font-bold text-amber-200/90">كود المكتب</p>
          <p className="font-mono text-xs font-black tracking-wider !text-white">{displayCode}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded-lg p-1.5 text-white/80 hover:bg-white/10 hover:text-white transition-colors"
          aria-label="نسخ كود المكتب"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
      </div>
    );
  }

  if (variant === 'hero') {
    return (
      <div
        className="relative w-full md:w-auto md:min-w-[280px] rounded-2xl border border-white/15 bg-white/10 backdrop-blur-md p-4 shadow-2xl"
        dir="rtl"
      >
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-amber-400/10 via-transparent to-indigo-400/10 pointer-events-none" />
        <div className="relative space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/30">
                <KeyRound className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300/90">Firm Code</p>
                <p className="text-xs font-bold text-white">كود انضمام المكتب</p>
              </div>
            </div>
            <Share2 className="w-4 h-4 text-indigo-200/60" aria-hidden="true" />
          </div>

          <div className="rounded-xl border border-white/20 bg-slate-950/40 px-4 py-3 text-center">
            <div className="flex items-center justify-center gap-1 font-mono font-black tracking-[0.25em] text-white">
              <span className="text-2xl sm:text-3xl text-amber-400">{prefix}</span>
              <span className="text-xl text-white/40">-</span>
              <span className="text-2xl sm:text-3xl">{suffix}</span>
            </div>
          </div>

          <p className="text-[10px] leading-relaxed text-indigo-100/80 text-right">
            {firmName
              ? `شارك الكود مع محامي ${firmName} للانضمام للمنصة.`
              : 'شارك هذا الكود مع المحامين والمساعدين للانضمام.'}
          </p>

          <button
            type="button"
            onClick={() => void handleCopy()}
            className={`w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold transition-all ${
              copied
                ? 'bg-emerald-500 text-white'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/25'
            }`}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'تم نسخ الكود بنجاح' : 'نسخ كود المكتب'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-lg shadow-slate-200/50"
      dir="rtl"
      aria-labelledby="firm-code-heading"
    >
      <div className="bg-gradient-to-l from-indigo-950 via-indigo-900 to-slate-900 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-slate-950 shadow-md">
            <KeyRound className="w-5 h-5" aria-hidden="true" />
          </div>
          <div>
            <h3 id="firm-code-heading" className="text-sm font-black text-white">
              كود المكتب — Firm Code
            </h3>
            <p className="text-[11px] text-indigo-200/90 mt-0.5">
              {firmName ?? 'مكتب المحاماة'}
            </p>
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4 bg-gradient-to-b from-slate-50 to-white">
        <p className="text-xs text-slate-600 leading-relaxed text-right">
          استخدم هذا الكود عند تسجيل المحامين والمساعدين. الكود فريد على مستوى النظام ولا يمكن تكراره.
        </p>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="flex-1 rounded-xl border-2 border-dashed border-amber-300/70 bg-amber-50/50 px-5 py-4 text-center">
            <p className="text-[10px] font-bold text-amber-800/70 uppercase tracking-widest mb-1">Your Code</p>
            <div className="flex items-center justify-center gap-1 font-mono font-black tracking-[0.2em] text-slate-900">
              <span className="text-2xl text-indigo-900">{prefix}</span>
              <span className="text-lg text-slate-400">-</span>
              <span className="text-2xl">{suffix}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-5 py-4 text-sm font-bold transition-all ${
              copied
                ? 'bg-emerald-600 text-white'
                : 'bg-indigo-900 hover:bg-indigo-800 text-white shadow-md'
            }`}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'تم النسخ' : 'نسخ الكود'}
          </button>
        </div>
      </div>
    </section>
  );
}
