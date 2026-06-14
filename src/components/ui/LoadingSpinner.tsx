interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

const sizes = { sm: 'w-5 h-5', md: 'w-8 h-8', lg: 'w-12 h-12' };

export function LoadingSpinner({ size = 'md', label = 'جاري التحميل...' }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8" role="status" aria-live="polite">
      <div
        className={`${sizes[size]} border-3 border-slate-200 border-t-amber-500 rounded-full animate-spin`}
        aria-hidden="true"
      />
      <span className="text-sm text-slate-500 font-medium">{label}</span>
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <LoadingSpinner size="lg" label="جاري تحميل البيانات..." />
    </div>
  );
}
