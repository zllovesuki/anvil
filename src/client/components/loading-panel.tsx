export const LoadingPanel = ({ label }: { label: string }) => (
  <div
    role="status"
    aria-live="polite"
    className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-8 text-center shadow-[0_24px_80px_-48px_rgba(0,0,0,0.85)]"
  >
    <div className="mx-auto mb-4 h-2 w-16 rounded-full bg-accent-500/70 shadow-[0_0_24px_rgba(59,130,246,0.35)]" />
    <p className="text-sm font-medium text-zinc-300">{label}</p>
  </div>
);
