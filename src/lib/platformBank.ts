import { supabase } from './supabaseClient';
import { KARIMI_BANK } from '../constants/subscription';
import type { PlatformBankDetails } from '../types/app';
import { formatQueryErrorMessage } from './supabaseQueryHelpers';

export const platformBankQueryKey = ['platform-bank-details'] as const;

export function defaultPlatformBankDetails(): PlatformBankDetails {
  return {
    bankName: KARIMI_BANK.bankName,
    accountName: KARIMI_BANK.accountName,
    accountNumber: KARIMI_BANK.accountNumber,
    iban: KARIMI_BANK.iban,
    note: KARIMI_BANK.note
  };
}

function mapBankDetails(raw: Record<string, unknown> | null): PlatformBankDetails {
  if (!raw) return defaultPlatformBankDetails();
  return {
    bankName: String(raw.bankName ?? KARIMI_BANK.bankName),
    accountName: String(raw.accountName ?? KARIMI_BANK.accountName),
    accountNumber: String(raw.accountNumber ?? KARIMI_BANK.accountNumber),
    iban: String(raw.iban ?? KARIMI_BANK.iban),
    note: String(raw.note ?? KARIMI_BANK.note)
  };
}

export async function fetchPlatformBankDetails(): Promise<PlatformBankDetails> {
  const { data, error } = await supabase.rpc('get_platform_bank_details');
  if (error) {
    console.warn('[platformBank] fetch failed, using defaults:', error.message);
    return defaultPlatformBankDetails();
  }
  return mapBankDetails(data as Record<string, unknown> | null);
}

export async function ensurePlatformBillingAccess(): Promise<boolean> {
  const { data, error } = await supabase.rpc('ensure_platform_billing_access');
  if (error) {
    if (/ensure_platform_billing_access|42883|does not exist/i.test(error.message)) {
      return false;
    }
    throw error;
  }
  return Boolean(data);
}

export async function savePlatformBankDetails(input: PlatformBankDetails): Promise<PlatformBankDetails> {
  await ensurePlatformBillingAccess().catch(() => false);

  const { data, error } = await supabase.rpc('upsert_platform_bank_details', {
    p_bank_name: input.bankName.trim(),
    p_account_name: input.accountName.trim(),
    p_iban: input.iban.trim(),
    p_account_number: input.accountNumber.trim() || null,
    p_note: input.note.trim() || null
  });
  if (error) {
    const msg = formatQueryErrorMessage(error, 'فشل حفظ بيانات البنك');
    if (/not_authorized/i.test(error.message)) {
      throw new Error('غير مصرح — من صفحة «إدارة الاشتراكات» اضغط «تفعيل صلاحيات سوبر أدمن» ثم أعد المحاولة.');
    }
    if (/invalid_iban/i.test(error.message)) {
      throw new Error('رقم IBAN غير صالح — يجب أن يكون 8 أحرف على الأقل.');
    }
    throw new Error(msg);
  }
  return mapBankDetails(data as Record<string, unknown> | null);
}
