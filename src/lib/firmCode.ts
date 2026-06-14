import { supabase } from './supabaseClient';

/** Firm code format: ABC-1234 (8 chars, uppercase, 6–12 char range with separator) */
const FIRM_CODE_PATTERN = /^[A-Z]{3}-[0-9]{4}$/;

export function normalizeFirmCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidFirmCodeFormat(value: string): boolean {
  return FIRM_CODE_PATTERN.test(normalizeFirmCode(value));
}

export function buildFirmCodePrefix(firmName: string): string {
  const words = firmName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const firstLongWord = words.find((word) => word.length >= 3);
  const prefix = firstLongWord?.slice(0, 3) ?? words.map((word) => word[0]).join('').slice(0, 3);

  return prefix.padEnd(3, 'X').slice(0, 3);
}

export function generateFirmCodeCandidate(firmName: string): string {
  const randomValues = crypto.getRandomValues(new Uint32Array(1));
  const digits = (randomValues[0] ?? 0) % 10000;
  return `${buildFirmCodePrefix(firmName)}-${String(digits).padStart(4, '0')}`;
}

export async function isFirmCodeAvailable(code: string): Promise<boolean> {
  const normalized = normalizeFirmCode(code);
  if (!isValidFirmCodeFormat(normalized)) return false;

  const { data, error } = await supabase.rpc('office_code_exists', { office_code_input: normalized });
  if (error) throw error;
  return !data;
}

export async function generateUniqueFirmCode(firmName: string, maxAttempts = 20): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generateFirmCodeCandidate(firmName);
    if (await isFirmCodeAvailable(code)) return code;
  }

  throw new Error('تعذر إنشاء كود مكتب فريد. يرجى المحاولة مرة أخرى.');
}

export interface FirmCodeValidationResult {
  valid: boolean;
  normalizedCode: string;
  firmId?: string;
  firmName?: string;
  error?: string;
}

/** Validates format + existence in Supabase (lawyer registration). */
export async function validateFirmCodeForRegistration(code: string): Promise<FirmCodeValidationResult> {
  const normalizedCode = normalizeFirmCode(code);

  if (!normalizedCode) {
    return { valid: false, normalizedCode, error: 'يرجى إدخال كود المكتب.' };
  }

  if (!isValidFirmCodeFormat(normalizedCode)) {
    return {
      valid: false,
      normalizedCode,
      error: 'صيغة الكود غير صحيحة. مثال: HUD-4829'
    };
  }

  try {
    const { data, error } = await supabase.rpc('get_office_by_code', { office_code_input: normalizedCode });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return { valid: false, normalizedCode, error: 'كود المكتب غير موجود أو غير نشط.' };
    }

    return {
      valid: true,
      normalizedCode,
      firmId: row.id as string,
      firmName: row.name as string
    };
  } catch {
    return { valid: false, normalizedCode, error: 'تعذر التحقق من كود المكتب. تحقق من الاتصال.' };
  }
}
