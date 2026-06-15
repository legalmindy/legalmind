interface UserAvatarProps {
  name: string;
  imageUrl?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClasses = {
  sm: 'h-8 w-8 text-[10px] lg:h-9 lg:w-9',
  md: 'h-10 w-10 text-xs',
  lg: 'h-16 w-16 text-sm',
  xl: 'h-24 w-24 text-lg'
};

export function UserAvatar({ name, imageUrl, size = 'sm', className = '' }: UserAvatarProps) {
  const initials = name.trim().slice(0, 2) || '؟';
  const dim = sizeClasses[size];

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className={`shrink-0 rounded-full border border-white/30 object-cover shadow-sm ${dim} ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full border border-white/30 bg-white font-bold text-[#7A1F2B] shadow-sm ${dim} ${className}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
