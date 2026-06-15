import { useCallback, useEffect, useRef, useState } from 'react';
import { initializeLocalDatabase, getLocalSyncStatus, type SyncStatus } from '../lib/localDbClient';
import { isOnline, isSyncTemporarilyDisabled, runSyncCycle, type SyncResult } from '../lib/syncEngine';

export interface OfflineSyncState extends SyncStatus {
  online: boolean;
  syncing: boolean;
  lastResult?: SyncResult;
  error?: string;
  syncPaused?: boolean;
}

const SYNC_INTERVAL_MS = 90_000;
const INITIAL_SYNC_DELAY_MS = 4_000;

export function useOfflineSync(enabled: boolean) {
  const [state, setState] = useState<OfflineSyncState>({
    online: isOnline(),
    syncing: false,
    pendingEvents: 0,
    conflicts: 0
  });
  const syncTimerRef = useRef<number | null>(null);

  const refreshStatus = useCallback(async () => {
    const status = await getLocalSyncStatus();
    setState((current) => ({
      ...current,
      ...status,
      online: isOnline(),
      syncPaused: isSyncTemporarilyDisabled()
    }));
  }, []);

  const syncNow = useCallback(async () => {
    if (!enabled) return;
    if (isSyncTemporarilyDisabled()) {
      setState((current) => ({ ...current, syncPaused: true, online: isOnline() }));
      return;
    }

    setState((current) => ({ ...current, syncing: true, error: undefined, syncPaused: false }));
    try {
      const result = await runSyncCycle();
      setState((current) => ({
        ...current,
        ...result,
        lastResult: result,
        online: isOnline(),
        syncing: false,
        syncPaused: isSyncTemporarilyDisabled()
      }));
    } catch (err) {
      setState((current) => ({
        ...current,
        online: isOnline(),
        syncing: false,
        syncPaused: isSyncTemporarilyDisabled(),
        error: err instanceof Error ? err.message : 'فشلت المزامنة'
      }));
    }
  }, [enabled]);

  const scheduleSync = useCallback((delayMs: number) => {
    if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      void syncNow();
    }, delayMs);
  }, [syncNow]);

  useEffect(() => {
    if (!enabled) return;
    initializeLocalDatabase()
      .then((status) => setState((current) => ({ ...current, ...status, online: isOnline() })))
      .catch((err) => setState((current) => ({
        ...current,
        error: err instanceof Error ? err.message : String(err)
      })));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    scheduleSync(INITIAL_SYNC_DELAY_MS);
    return () => {
      if (syncTimerRef.current) window.clearTimeout(syncTimerRef.current);
    };
  }, [enabled, scheduleSync]);

  useEffect(() => {
    const onOnline = () => {
      setState((current) => ({ ...current, online: true }));
      if (enabled) scheduleSync(1_500);
    };
    const onOffline = () => {
      setState((current) => ({ ...current, online: false }));
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [enabled, scheduleSync]);

  useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => {
      if (isOnline()) scheduleSync(500);
      else void refreshStatus();
    }, SYNC_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [enabled, refreshStatus, scheduleSync]);

  return { ...state, syncNow, refreshStatus };
}
