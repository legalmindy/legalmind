import { useState } from 'react';
import { Cloud, CloudOff, RefreshCcw, AlertTriangle, CheckCircle2, X } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const hasProblem = !online || error || conflicts > 0 || syncPaused;
  const hasActivity = syncing || pendingEvents > 0;

  // In normal steady state (online, no error, no pending, not syncing) stay invisible
  const shouldShow = hasProblem || hasActivity;

  if (dismissed && !hasProblem) return null;
  if (!shouldShow) return null;

  // Determine pill color/icon
  let dotClass = 'bg-emerald-400';
  let PillIcon = Cloud;
  if (!online) { dotClass = 'bg-amber-400'; PillIcon = CloudOff; }
  if (error || conflicts > 0) { dotClass = 'bg-rose-500'; PillIcon = AlertTriangle; }
  if (syncing) { dotClass = 'bg-blue-400 animate-pulse'; PillIcon = RefreshCcw; }
  if (!hasProblem && !hasActivity) { dotClass = 'bg-emerald-400'; PillIcon = CheckCircle2; }

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col items-start gap-2" dir="rtl">
      {/* Expanded panel */}
      {expanded && (
        <div className="bg-white border border-slate-200 shadow-xl rounded-2xl p-4 text-xs text-right w-72 space-y-3 animate-in slide-in-from-bottom-2 fade-in duration-150">
          <div className="flex items-center justify-between">
            <span className="font-black text-slate-800 text-sm">حالة المزامنة</span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Status rows */}
          <div className="space-y-2">
            <StatusRow
              label="الاتصال"
              value={online ? 'متصل بالإنترنت' : 'غير متصل — يعمل محلياً'}
              color={online ? 'emerald' : 'amber'}
            />
            {pendingEvents > 0 && (
              <StatusRow
                label="عمليات معلّقة"
                value={String(pendingEvents)}
                color="blue"
              />
            )}
            {conflicts > 0 && (
              <StatusRow
                label="تعارضات"
                value={String(conflicts)}
                color="rose"
              />
            )}
            {lastSyncAt && (
              <StatusRow
                label="آخر مزامنة"
                value={new Date(lastSyncAt).toLocaleTimeString('ar-YE', { hour: '2-digit', minute: '2-digit' })}
                color="slate"
              />
            )}
            {syncPaused && (
              <StatusRow label="المزامنة" value="متوقفة مؤقتاً — ستُستأنف تلقائياً" color="amber" />
            )}
            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-2 text-rose-700 font-medium text-[11px]">
                {error}
              </div>
            )}
          </div>

          {/* Sync now button */}
          <button
            type="button"
            onClick={() => { onSyncNow(); setExpanded(false); }}
            disabled={!online || syncing}
            className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white font-bold py-2 rounded-xl text-xs transition-colors"
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'جارٍ المزامنة...' : 'مزامنة الآن'}
          </button>
        </div>
      )}

      {/* Pill trigger */}
      <button
        type="button"
        onClick={() => { setExpanded((v) => !v); setDismissed(false); }}
        className={`
          flex items-center gap-2 px-3 py-2 rounded-full shadow-lg border border-white/30
          text-white text-[11px] font-bold transition-all duration-200 hover:scale-105 active:scale-95
          ${error || conflicts > 0 ? 'bg-rose-500 hover:bg-rose-600' :
            !online             ? 'bg-amber-500 hover:bg-amber-600' :
            syncing             ? 'bg-blue-500 hover:bg-blue-600' :
                                  'bg-slate-700 hover:bg-slate-800'}
        `}
        title="حالة المزامنة"
      >
        <span className={`w-2 h-2 rounded-full ${dotClass} ring-2 ring-white/50`} />
        <PillIcon className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
        <span>
          {syncing           ? 'مزامنة...'
           : error           ? 'خطأ في المزامنة'
           : !online         ? 'غير متصل'
           : pendingEvents > 0 ? `${pendingEvents} معلّق`
           : syncPaused      ? 'متوقفة مؤقتاً'
           :                   'متزامن'}
        </span>
        {!hasProblem && !hasActivity && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
            className="mr-1 text-white/70 hover:text-white"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </button>
    </div>
  );
}

function StatusRow({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-700 bg-emerald-50',
    amber:   'text-amber-700 bg-amber-50',
    blue:    'text-blue-700 bg-blue-50',
    rose:    'text-rose-700 bg-rose-50',
    slate:   'text-slate-600 bg-slate-50',
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={`px-2 py-0.5 rounded-lg font-bold text-[11px] ${colorMap[color] ?? colorMap.slate}`}>
        {value}
      </span>
    </div>
  );
}
