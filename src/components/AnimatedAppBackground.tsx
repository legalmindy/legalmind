export function AnimatedAppBackground({ variant = 'workspace' }: { variant?: 'workspace' | 'landing' }) {
  const isLanding = variant === 'landing';

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div
        className={`absolute inset-0 ${
          isLanding
            ? 'bg-gradient-to-br from-[#fafafa] via-white to-[#f3f4f6]'
            : 'bg-gradient-to-br from-[#f8fafc] via-[#fafafa] to-[#f1f5f9]'
        }`}
      />
      <div className="app-bg-orb app-bg-orb-1 bg-[#7A1F2B]/10" />
      <div className="app-bg-orb app-bg-orb-2 bg-indigo-500/8" />
      <div className="app-bg-orb app-bg-orb-3 bg-amber-400/10" />
      <div className="app-bg-grid absolute inset-0 opacity-[0.35]" />
    </div>
  );
}
