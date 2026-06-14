import { useCallback, useState } from 'react';
import { Check, Copy, KeyRound } from 'lucide-react';
import { normalizeFirmCode } from '../lib/firmCode';

interface FirmCodeCardProps {
  firmCode: string;
  firmName?: string;
  onCopied?: (message: string) => void;
  compact?: boolean;
}

export function FirmCodeCard({ firmCode, firmName, onCopied, compact = false }: FirmCodeCardProps) {
  const [copied, setCopied] = useState(false);
  const displayCode = normalizeFirmCode(firmCode);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayCode);
      setCopied(true);
      onCopied?.('تم نسخ كود المكتب بنجاح.');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onCopied?.('تعذر نسخ الكود. حاول يدوياً.');
    }
  }, [displayCode, onCopied]);

  if (compact) {
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

  return (
    <section
      className="rounded-2xl border border-indigo-100 bg-gradient-to-l from-white via-indigo-50/40 to-amber-50/50 p-5 shadow-sm"
      dir="rtl"
      aria-labelledby="firm-code-heading"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-900 text-amber-400 shadow">
            <KeyRound className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="text-right min-w-0">
            <h3 id="firm-code-heading" className="text-sm font-black text-slate-900">
              كود المكتب
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              {firmName
                ? `شارك هذا الكود مع المحامين والمساعدين للانضمام إلى ${firmName}.`
                : 'شارك هذا الكود مع فريقك للانضمام إلى المكتب.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch sm:self-auto">
          <div className="flex-1 sm:flex-initial rounded-xl border border-slate-200 bg-white px-4 py-3 text-center min-w-[140px]">
            <span className="font-mono text-lg sm:text-xl font-black tracking-[0.2em] text-slate-900">
              {displayCode}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-3 text-xs transition-all shadow-sm min-w-[120px]"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'تم النسخ' : 'نسخ الكود'}
          </button>
        </div>
      </div>
    </section>
  );
}
