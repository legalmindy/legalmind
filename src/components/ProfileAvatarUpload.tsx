import { useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { UserAvatar } from './ui/UserAvatar';
import { validateAvatarFile } from '../lib/profileImage';

interface ProfileAvatarUploadProps {
  name: string;
  imageUrl?: string;
  uploading?: boolean;
  onFileSelect: (file: File) => void;
}

export function ProfileAvatarUpload({ name, imageUrl, uploading, onFileSelect }: ProfileAvatarUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');

  const handleChange = (file: File | undefined) => {
    if (!file) return;
    const validation = validateAvatarFile(file);
    if (!validation.valid) {
      setError(validation.error ?? 'ملف غير صالح.');
      return;
    }
    setError('');
    onFileSelect(file);
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <UserAvatar
          name={name}
          imageUrl={imageUrl}
          size="xl"
          className="border-slate-200 bg-slate-100 text-[#7A1F2B]"
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="absolute -bottom-1 -left-1 flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[#7A1F2B] text-white shadow-md transition-colors hover:bg-[#641923] disabled:opacity-60"
          aria-label="تغيير الصورة الشخصية"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => handleChange(e.target.files?.[0])}
        />
      </div>
      <p className="text-[11px] text-slate-500">JPG أو PNG أو WEBP — حتى 2 ميجابايت</p>
      {error ? <p className="text-[11px] font-bold text-rose-600" role="alert">{error}</p> : null}
    </div>
  );
}
