import { AlertCircle, RefreshCw } from 'lucide-react';

interface QueryErrorBannerProps {
  message?: string;
  onRetry: () => void;
}

export function QueryErrorBanner({
  message = 'عذراً، تعذر الاتصال بالسيرفر. يرجى التحقق من الإنترنت وإعادة المحاولة.',
  onRetry
}: QueryErrorBannerProps) {
  return (
    <div className="mx-4 mt-4 sm:mx-6 lg:mx-8 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-right">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-rose-900">تعذر تحميل البيانات</p>
          <p className="text-xs text-rose-700 mt-1 leading-relaxed">{message}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 shrink-0 bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 rounded-xl text-xs transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        إعادة المحاولة
      </button>
    </div>
  );
}

export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('connection') ||
    msg.includes('timeout') ||
    msg.includes('failed to fetch') ||
    msg.includes('err_connection')
  );
}

export function toArabicQueryError(error: unknown): string {
  if (isNetworkError(error)) {
    return 'عذراً، تعذر الاتصال بالسيرفر. يرجى التحقق من الإنترنت وإعادة المحاولة.';
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'حدث خطأ أثناء تحميل البيانات. يرجى إعادة المحاولة.';
}
