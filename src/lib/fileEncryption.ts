import { supabase } from './supabaseClient';
import { throwIfSupabaseError } from './supabaseQueryHelpers';

const SENSITIVE_KEYWORDS = ['عقد', 'مذكرة', 'حكم', 'وثيقة', 'contract', 'memo', 'judgment', 'legal'];

let cachedKey: string | null = null;

export function isSensitiveDocument(title: string, category?: string): boolean {
  const haystack = `${title} ${category ?? ''}`.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => haystack.includes(kw.toLowerCase()));
}

async function getFirmEncryptionKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    const { data, error } = await supabase.rpc('get_firm_document_encryption_key');
    throwIfSupabaseError(error);
    if (!data || typeof data !== 'string') throw new Error('تعذر الحصول على مفتاح التشفير');
    cachedKey = data;
  }

  const raw = Uint8Array.from(atob(cachedKey), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptFileBlob(file: Blob): Promise<Blob> {
  const key = await getFirmEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = await file.arrayBuffer();
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
  const payload = new Uint8Array(iv.byteLength + cipher.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(cipher), iv.byteLength);
  return new Blob([payload], { type: 'application/octet-stream' });
}

export async function decryptFileBlob(encrypted: Blob): Promise<Blob> {
  const key = await getFirmEncryptionKey();
  const buffer = await encrypted.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const iv = bytes.slice(0, 12);
  const cipher = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new Blob([plain]);
}

export function clearEncryptionKeyCache(): void {
  cachedKey = null;
}
