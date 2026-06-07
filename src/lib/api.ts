import { supabase } from './supabaseClient';
import type { CaseRecord, Client, DocumentItem, Employee, SessionItem } from '../types/app';

export async function fetchClients(): Promise<Client[]> {
  const { data, error } = await supabase.from('clients').select('*');
  if (error) throw error;
  return data as Client[];
}

export async function fetchCases(): Promise<CaseRecord[]> {
  const { data, error } = await supabase.from('cases').select('*');
  if (error) throw error;
  return data as CaseRecord[];
}

export async function fetchArchivedCases(): Promise<CaseRecord[]> {
  const { data, error } = await supabase.from('cases').select('*').in('status', ['archived', 'closed']);
  if (error) throw error;
  return data as CaseRecord[];
}

export async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.from('employees').select('*');
  if (error) throw error;
  return data as Employee[];
}

export async function uploadAttachment(file: File, caseId: string, uploadedBy: string) {
  const folder = `case-documents/${caseId}`;
  const path = `${folder}/${Date.now()}-${file.name}`;

  const { data: storageData, error: storageError } = await supabase.storage
    .from('case-documents')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (storageError) throw storageError;

  const { data, error } = await supabase.from('case_attachments').insert([
    {
      case_id: caseId,
      file_name: file.name,
      file_type: file.type as any,
      file_size: file.size,
      storage_path: path,
      uploaded_by: uploadedBy
    }
  ]).select().single();

  if (error) throw error;

  return data;
}
