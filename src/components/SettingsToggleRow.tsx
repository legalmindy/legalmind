import { Check } from 'lucide-react';

interface SettingsToggleRowProps {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function SettingsToggleRow({ title, description, checked, onChange, disabled }: SettingsToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-4 border-b border-slate-100 last:border-b-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={`shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center transition-all disabled:opacity-50 ${
          checked
            ? 'bg-amber-50 border-amber-300 text-amber-600'
            : 'bg-white border-slate-200 text-transparent hover:border-slate-300'
        }`}
      >
        <Check className="w-4 h-4 stroke-[3]" />
      </button>
      <div className="flex-1 text-right min-w-0">
        <h4 className="font-bold text-slate-800 text-sm">{title}</h4>
        {description ? <p className="text-slate-400 mt-0.5 text-xs leading-relaxed">{description}</p> : null}
      </div>
    </div>
  );
}
