import { supabase } from './supabaseClient';
import {
  getLocalSyncStatus,
  listOutboxEvents,
  markOutboxEventSynced,
  recordSyncConflict,
  updateSyncCursor,
  upsertLocalRow,
  type LocalTable,
  type OutboxEvent,
  type SyncStatus
} from './localDbClient';

/** Tables allowed by Supabase sync_pull_table RPC (must match DB allow-list). */
export const REMOTE_SYNC_TABLES = [
  'firms',
  'employees',
  'invitations',
  'clients',
  'cases',
  'sessions',
  'documents',
  'case_attachments',
  'lawyers',
  'notifications'
] as const satisfies readonly LocalTable[];

export type RemoteSyncTable = (typeof REMOTE_SYNC_TABLES)[number];

export interface SyncResult extends SyncStatus {
  pushed: number;
  pulled: number;
}

let syncInFlight = false;

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export async function pushOutboxEvent(event: OutboxEvent): Promise<void> {
  const { error } = await supabase.rpc('sync_apply_event', {
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

  const { data, error } = await supabase.rpc('sync_pull_table', {
    table_name: tableName,
    since_cursor: sinceCursor
  });

  if (error) {
    const msg = error.message ?? String(error);
    if (!msg.includes('Failed to fetch') && !msg.includes('ERR_CONNECTION')) {
      console.warn(`[sync] pull skipped for ${tableName}:`, msg);
    }
    return 0;
  }

  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];

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
  if (syncInFlight) {
    const status = await getLocalSyncStatus();
    return { ...status, pushed: 0, pulled: 0 };
  }
  if (!isOnline()) {
    const status = await getLocalSyncStatus();
    return { ...status, pushed: 0, pulled: 0 };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const status = await getLocalSyncStatus();
    return { ...status, pushed: 0, pulled: 0 };
  }

  syncInFlight = true;
  try {
    const outbox = await listOutboxEvents(100);
    let pushed = 0;
    for (const event of outbox) {
      try {
        await pushOutboxEvent(event);
        pushed += 1;
      } catch (err) {
        console.warn('[sync] push failed:', err instanceof Error ? err.message : err);
      }
    }

    let pulled = 0;
    for (const tableName of REMOTE_SYNC_TABLES) {
      try {
        pulled += await pullRemoteChanges(tableName);
      } catch (err) {
        console.warn(`[sync] pull failed for ${tableName}:`, err instanceof Error ? err.message : err);
      }
    }

    const status = await getLocalSyncStatus();
    return { ...status, pushed, pulled };
  } finally {
    syncInFlight = false;
  }
}
