interface SkeletonProps {
  className?: string;
  lines?: number;
}

export function Skeleton({ className = '', lines = 1 }: SkeletonProps) {
  if (lines > 1) {
    return (
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={`animate-pulse bg-slate-200 rounded-lg h-4 ${className}`} style={{ width: `${100 - i * 15}%` }} />
        ))}
      </div>
    );
  }
  return <div className={`animate-pulse bg-slate-200 rounded-lg ${className}`} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="جاري التحميل">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-8" />
          ))}
        </div>
      ))}
      <span className="sr-only">جاري تحميل البيانات...</span>
    </div>
  );
}

export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" role="status" aria-label="جاري التحميل">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-2xl border border-slate-100 p-5 space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton lines={2} />
          <Skeleton className="h-8 w-1/3" />
        </div>
      ))}
      <span className="sr-only">جاري تحميل البيانات...</span>
    </div>
  );
}
