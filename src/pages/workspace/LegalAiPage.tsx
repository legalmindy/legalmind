import { LegalAiPanel } from '../../components/LegalAiPanel';

/** Standalone route wrapper — redirects to documents in App; kept for deep links. */
export function LegalAiPage() {
  return (
    <div className="mx-auto mt-6 max-w-5xl px-4 pb-12">
      <LegalAiPanel />
    </div>
  );
}
