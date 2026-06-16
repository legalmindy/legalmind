import { supabase } from './supabaseClient';
import {
  getLocalSyncStatus,
  isTauriRuntime,
  listOutboxEvents,
  markOutboxEventSynced,
  recordSyncConflict,
  updateSyncCursor,
  upsertLocalRow,
  type LocalTable,
  type OutboxEvent,
  type SyncStatus
} from './localDbClient';
import { callRpc } from './rpcClient';

/**
 * Tables synced for offline cache. Excludes firms/invitations/notifications
 * (loaded via normal API). Must match DB allow-list in sync_pull_table.
 */
export const REMOTE_SYNC_TABLES = [
  'clients',
  'cases',
  'sessions',
  'documents',
  'employees',
  'lawyers'
] as const satisfies readonly LocalTable[];

export type RemoteSyncTable = (typeof REMOTE_SYNC_TABLES)[number];

export interface SyncResult extends SyncStatus {
  pushed: number;
  pulled: number;
  skipped?: boolean;
}

const TABLE_PULL_DELAY_MS = 200;
let syncInFlight = false;
let syncDisabledUntil = 0;
let consecutivePullFailures = 0;

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function isSyncTemporarilyDisabled(): boolean {
  return Date.now() < syncDisabledUntil;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function notePullFailure(): void {
  consecutivePullFailures += 1;
  if (consecutivePullFailures >= 3) {
    syncDisabledUntil = Date.now() + 5 * 60_000;
  }
}

function notePullSuccess(): void {
  consecutivePullFailures = 0;
  syncDisabledUntil = 0;
}

export async function pushOutboxEvent(event: OutboxEvent): Promise<void> {
  const { error } = await callRpc<void>('sync_apply_event', {
    event_id: event.id,
    table_name: event.tableName,
    record_id: event.recordId,
    firm_id: event.firmId ?? null,
    event_type: event.eventType,
    payload: event.payload
  });
  if (error) throw error;
  await markOutboxEventSynced(event.id);
}

export async function pullRemoteChanges(tableName: RemoteSyncTable): Promise<number> {
  const rawCursor = localStorage.getItem(`legalmind.sync.cursor.${tableName}`);
  const sinceCursor = rawCursor?.trim() ? rawCursor : null;

  const { data, error } = await callRpc<Record<string, unknown>[]>(
    'sync_pull_table',
    { table_name: tableName, since_cursor: sinceCursor },
    { timeoutMs: 10_000, retries: 1 }
  );

  if (error) {
    notePullFailure();
    return 0;
  }

  notePullSuccess();
  const rows = Array.isArray(data) ? data : [];

  for (const row of rows) {
    const id = row.id;
    if (typeof id !== 'string') continue;
    try {
      await upsertLocalRow({
        table: tableName,
        eventType: `${tableName}.pulled`,
        row
      });
    } catch (err) {
      await recordSyncConflict(
        tableName,
        id,
        {},
        row,
        err instanceof Error ? err.message : 'Failed to apply remote row locally'
      );
    }
  }

  const nextCursor = rows.reduce<string | null>((cursor, row) => {
    const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
    if (!updatedAt) return cursor;
    return !cursor || updatedAt > cursor ? updatedAt : cursor;
  }, null);

  if (nextCursor) {
    localStorage.setItem(`legalmind.sync.cursor.${tableName}`, nextCursor);
    await updateSyncCursor(tableName, nextCursor);
  }

  return rows.length;
}

export async function runSyncCycle(): Promise<SyncResult> {
  const status = await getLocalSyncStatus();

  // In a browser (non-Tauri) environment the app talks to Supabase directly
  // via TanStack Query — no local DB, no outbox, no pull needed.
  if (!isTauriRuntime()) {
    return { ...status, pendingEvents: 0, pushed: 0, pulled: 0, skipped: true };
  }

  if (syncInFlight) return { ...status, pushed: 0, pulled: 0, skipped: true };
  if (!isOnline() || isSyncTemporarilyDisabled()) {
    return { ...status, pushed: 0, pulled: 0, skipped: true };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { ...status, pushed: 0, pulled: 0, skipped: true };

  syncInFlight = true;
  try {
    const outbox = await listOutboxEvents(100);
    let pushed = 0;
    for (const event of outbox) {
      try {
        await pushOutboxEvent(event);
        pushed += 1;
      } catch {
        // Outbox events retry on next cycle
      }
    }

    let pulled = 0;
    for (const tableName of REMOTE_SYNC_TABLES) {
      try {
        pulled += await pullRemoteChanges(tableName);
      } catch {
        notePullFailure();
      }
      await sleep(TABLE_PULL_DELAY_MS);
    }

    const nextStatus = await getLocalSyncStatus();
    return { ...nextStatus, pushed, pulled };
  } finally {
    syncInFlight = false;
  }
}
