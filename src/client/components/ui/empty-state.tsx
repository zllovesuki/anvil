import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export const EmptyState = ({ icon, title, description, action }: EmptyStateProps) => (
  <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-6">
    <div className="flex items-start gap-4">
      <div className="shrink-0 rounded-xl bg-accent-500/10 p-2.5 text-accent-300">{icon}</div>
      <div>
        <h2 className="font-display text-lg font-semibold text-zinc-100">{title}</h2>
        {description ? <p className="mt-2 text-sm text-zinc-500">{description}</p> : null}
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  </div>
);
