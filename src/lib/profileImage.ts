import { supabase } from './supabaseClient';

const AVATAR_MAX_SIZE = 2 * 1024 * 1024;
const AVATAR_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ProfileUpdateInput {
  fullName: string;
  phone?: string;
  licenseNo?: string;
  profileImage?: string;
}

export function validateAvatarFile(file: File): { valid: boolean; error?: string } {
  if (file.size === 0) return { valid: false, error: 'الملف فارغ.' };
  if (file.size > AVATAR_MAX_SIZE) return { valid: false, error: 'حجم الصورة يتجاوز 2 ميجابايت.' };
  if (!AVATAR_MIME_TYPES.has(file.type)) {
    return { valid: false, error: 'نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP.' };
  }
  return { valid: true };
}

function avatarExtension(file: File): string {
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

export async function uploadProfileAvatar(file: File, userId: string): Promise<string> {
  const validation = validateAvatarFile(file);
  if (!validation.valid) throw new Error(validation.error ?? 'ملف غير صالح');

  const ext = avatarExtension(file);
  const path = `${userId}/avatar.${ext}`;

  const { error: storageError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type });

  if (storageError) throw storageError;

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const versionedUrl = `${data.publicUrl}?v=${Date.now()}`;
  return versionedUrl;
}

export async function updateUserProfile(input: ProfileUpdateInput): Promise<void> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!authData.user) throw new Error('غير مسجل الدخول');

  const payload: Record<string, string | null> = {
    full_name: input.fullName.trim(),
    phone: input.phone?.trim() || null,
    license_no: input.licenseNo?.trim() || null
  };

  if (input.profileImage !== undefined) {
    payload.profile_image = input.profileImage || null;
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .update(payload)
    .eq('id', authData.user.id)
    .select('employee_id')
    .single();

  if (profileError) throw profileError;

  if (profile?.employee_id) {
    const employeePayload: Record<string, string | null> = {
      full_name: input.fullName.trim(),
      phone: input.phone?.trim() || null
    };
    if (input.profileImage !== undefined) {
      employeePayload.profile_image = input.profileImage || null;
    }

    const { error: employeeError } = await supabase
      .from('employees')
      .update(employeePayload)
      .eq('id', profile.employee_id);

    if (employeeError) throw employeeError;
  }
}
