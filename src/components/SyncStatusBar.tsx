import { Cloud, CloudOff, RefreshCcw, AlertTriangle } from 'lucide-react';
import type { OfflineSyncState } from '../hooks/useOfflineSync';

interface SyncStatusBarProps extends OfflineSyncState {
  onSyncNow: () => void;
}

export function SyncStatusBar({
  online,
  syncing,
  pendingEvents,
  conflicts,
  lastSyncAt,
  error,
  syncPaused,
  onSyncNow
}: SyncStatusBarProps) {
  return (
    <div className="bg-white border-b border-slate-100 text-xs text-slate-600">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 font-bold ${online ? 'text-emerald-700' : 'text-amber-700'}`}>
            {online ? <Cloud className="w-4 h-4" /> : <CloudOff className="w-4 h-4" />}
            {online ? 'متصل - المزامنة متاحة' : 'وضع عدم الاتصال - العمل محفوظ محلياً'}
          </span>
          <span>عمليات بانتظار المزامنة: <strong className="font-mono">{pendingEvents}</strong></span>
          {conflicts > 0 && (
            <span className="inline-flex items-center gap-1 text-rose-700 font-bold">
              <AlertTriangle className="w-4 h-4" /> تعارضات: {conflicts}
            </span>
          )}
          {lastSyncAt && <span className="text-slate-400">آخر مزامنة: {new Date(lastSyncAt).toLocaleString('ar-YE')}</span>}
          {syncPaused && (
            <span className="text-amber-700 font-bold">المزامنة متوقفة مؤقتاً — ستُستأنف تلقائياً</span>
          )}
          {error && <span className="text-rose-600 font-bold">{error}</span>}
        </div>
        <button
          type="button"
          onClick={onSyncNow}
          disabled={!online || syncing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-800 hover:bg-indigo-100 disabled:opacity-50 font-bold"
        >
          <RefreshCcw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          مزامنة الآن
        </button>
      </div>
    </div>
  );
}
