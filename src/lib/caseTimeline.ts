import { supabase } from './supabaseClient';
import { getCurrentFirmId } from './api';
import { throwIfSupabaseError } from './supabaseQueryHelpers';
import type { CaseTimelineEvent } from '../types/app';

function mapTimeline(row: Record<string, unknown>, actorName?: string): CaseTimelineEvent {
  return {
    id: row.id as string,
    eventType: String(row.event_type),
    title: String(row.title),
    details: (row.details as string) ?? undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined,
    actorName,
    createdAt: String(row.created_at)
  };
}

export async function fetchCaseTimeline(caseId: string): Promise<CaseTimelineEvent[]> {
  const firmId = await getCurrentFirmId();
  const { data, error } = await supabase
    .from('case_timeline_events')
    .select('*, employees(full_name)')
    .eq('firm_id', firmId)
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(200);
  throwIfSupabaseError(error);
  return (data ?? []).map((row: Record<string, unknown> & { employees?: { full_name?: string } | null }) =>
    mapTimeline(row, row.employees?.full_name)
  );
}

export async function appendCaseNote(caseId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('append_case_timeline_event', {
    p_case_id: caseId,
    p_event_type: 'note_added',
    p_title: 'ملاحظة على القضية',
    p_details: note,
    p_metadata: {}
  });
  throwIfSupabaseError(error);
}
