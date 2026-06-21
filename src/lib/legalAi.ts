import { supabase } from './supabaseClient';
import type { FunctionsHttpError } from '@supabase/supabase-js';

export type LegalAiAction = 'summarize' | 'contract_draft' | 'legal_research';

export interface SummarizePayload {
  action: 'summarize';
  text: string;
}

export interface ContractDraftPayload {
  action: 'contract_draft';
  contractType: string;
  firstParty: string;
  secondParty: string;
  subject: string;
  amount?: string;
  duration?: string;
  specialTerms?: string;
  jurisdiction?: string;
}

export interface LegalResearchPayload {
  action: 'legal_research';
  query: string;
}

export type LegalAiPayload = SummarizePayload | ContractDraftPayload | LegalResearchPayload;

export interface LegalAiResponse {
  result: string;
  action: LegalAiAction;
}

export const CONTRACT_TYPES = [
  'عقد أتعاب محاماة',
  'عقد توكيل قانوني',
  'عقد عمل',
  'عقد إيجار',
  'عقد بيع',
  'اتفاقية صلح',
  'اتفاقية سرية',
  'عقد شراكة'
] as const;

const MAX_TEXT_FILE_BYTES = 512_000;
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'json']);

async function parseFunctionError(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    try {
      const ctx = await (error as FunctionsHttpError).context.json();
      if (ctx && typeof ctx === 'object' && 'error' in ctx && typeof ctx.error === 'string') {
        return ctx.error;
      }
    } catch {
      /* ignore */
    }
  }
  if (error instanceof Error) {
    if (/failed to fetch|network|CORS/i.test(error.message)) {
      return 'تعذر الاتصال بخدمة الذكاء الاصطناعي. تأكد من نشر Edge Function (legal-ai) وإضافة OPENAI_API_KEY في Supabase.';
    }
    return error.message;
  }
  return 'فشل طلب المساعد القانوني.';
}

export async function callLegalAi(payload: LegalAiPayload): Promise<LegalAiResponse> {
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) {
    throw new Error('يجب تسجيل الدخول لاستخدام المساعد القانوني.');
  }

  const { data, error } = await supabase.functions.invoke('legal-ai', { body: payload });

  if (error) {
    throw new Error(await parseFunctionError(error));
  }

  const body = (data ?? {}) as { result?: string; error?: string; action?: LegalAiAction };
  if (body.error) throw new Error(body.error);
  if (!body.result) throw new Error('لم يُرجع المساعد نتيجة.');

  return { result: body.result, action: body.action ?? payload.action };
}

export async function readTextFromFile(file: File): Promise<string> {
  if (file.size > MAX_TEXT_FILE_BYTES) {
    throw new Error('حجم الملف كبير. الحد الأقصى 500 كيلوبايت للملفات النصية.');
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!TEXT_EXTENSIONS.has(ext)) {
    throw new Error('ارفع ملفاً نصياً (.txt أو .md) أو الصق نص المستند. ملفات PDF/DOCX تحتاج نسخ النص يدوياً.');
  }
  return (await file.text()).trim();
}

/** Try loading plain text from a stored document URL (txt/md only). */
export async function fetchDocumentText(url: string, title: string): Promise<string | null> {
  const ext = (url.split('?')[0]?.split('.').pop() ?? title.split('.').pop() ?? '').toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext)) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return text.length >= 40 ? text : null;
  } catch {
    return null;
  }
}

export async function checkLegalAiAccess(): Promise<boolean> {
  const { data, error } = await supabase.rpc('assert_ai_assistant_access');
  if (error) return false;
  return Boolean(data);
}
