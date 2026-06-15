import { Building2, Scale, type LucideIcon } from 'lucide-react';

type LogoVariant = 'law' | 'office';
type LogoSize = 'sm' | 'md' | 'lg';
type LogoTone = 'filled' | 'inverted';

const variants: Record<LogoVariant, { icon: LucideIcon; stroke: number }> = {
  law: { icon: Scale, stroke: 2.5 },
  office: { icon: Building2, stroke: 2 }
};

const sizes: Record<LogoSize, { box: string; icon: string }> = {
  sm: { box: 'h-9 w-9 rounded-lg lg:h-10 lg:w-10', icon: 'h-4 w-4 lg:h-5 lg:w-5' },
  md: { box: 'h-12 w-12 rounded-2xl', icon: 'h-6 w-6' },
  lg: { box: 'p-2.5 rounded-2xl', icon: 'w-6 h-6' }
};

const tones: Record<LogoTone, string> = {
  filled: 'bg-[#7A1F2B] text-white',
  inverted: 'bg-white text-[#7A1F2B]'
};

interface AppLogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  tone?: LogoTone;
  className?: string;
}

export function AppLogo({ variant = 'law', size = 'md', tone = 'filled', className = '' }: AppLogoProps) {
  const { icon: Icon, stroke } = variants[variant];
  const dim = sizes[size];

  return (
    <div
      className={`flex shrink-0 items-center justify-center shadow-sm shadow-black/10 ${tones[tone]} ${dim.box} ${className}`}
      aria-hidden="true"
    >
      <Icon className={dim.icon} strokeWidth={stroke} />
    </div>
  );
}
