import { supabase } from './supabaseClient';

/** Firm code format: ABC-1234 (8 chars, uppercase, globally unique) */
const FIRM_CODE_PATTERN = /^[A-Z]{3}-[0-9]{4}$/;

const ARABIC_PREFIX_HINTS: Array<{ pattern: RegExp; prefix: string }> = [
  { pattern: /عدال/, prefix: 'ADL' },
  { pattern: /يمن/, prefix: 'YEM' },
  { pattern: /قانون/, prefix: 'LAW' },
  { pattern: /عدل/, prefix: 'ADL' },
  { pattern: /حق/, prefix: 'LAW' },
  { pattern: /خبر/, prefix: 'EXP' }
];

export function normalizeFirmCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')      // strip all whitespace
    .replace(/-+/g, '-')      // collapse multiple dashes to one
    .replace(/[^\w-]/g, '');  // strip any non-word non-dash chars (e.g. unicode dashes)
}

export function isValidFirmCodeFormat(value: string): boolean {
  return FIRM_CODE_PATTERN.test(normalizeFirmCode(value));
}

export function buildFirmCodePrefix(firmName: string): string {
  const raw = firmName.trim();
  if (!raw) return 'LMY';

  if (/[\u0600-\u06FF]/.test(raw)) {
    const hint = ARABIC_PREFIX_HINTS.find((item) => item.pattern.test(raw));
    if (hint) return hint.prefix;
    const hash = Array.from(raw).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return String.fromCharCode(65 + (hash % 26), 65 + ((hash * 7) % 26), 65 + ((hash * 13) % 26));
  }

  const words = raw
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
export async function isEmailAvailableForRegistration(email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const { data, error } = await supabase.rpc('is_email_available_for_registration', {
    check_email: normalized
  });
  if (error) throw error;
  return Boolean(data);
}

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
