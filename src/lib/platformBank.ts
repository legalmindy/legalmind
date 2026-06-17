import { supabase } from './supabaseClient';
import { KARIMI_BANK } from '../constants/subscription';
import type { PlatformBankDetails } from '../types/app';

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

export async function savePlatformBankDetails(input: PlatformBankDetails): Promise<PlatformBankDetails> {
  const { data, error } = await supabase.rpc('upsert_platform_bank_details', {
    p_bank_name: input.bankName.trim(),
    p_account_name: input.accountName.trim(),
    p_iban: input.iban.trim(),
    p_account_number: input.accountNumber.trim() || null,
    p_note: input.note.trim() || null
  });
  if (error) throw error;
  return mapBankDetails(data as Record<string, unknown> | null);
}
