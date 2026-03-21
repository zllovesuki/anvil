import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export const EmptyState = ({ icon, title, description, action }: EmptyStateProps) => (
  <div className="rounded-2xl border border-zinc-800/60 bg-zinc-900/50 p-8 text-center">
    <div className="mx-auto mb-4 inline-flex rounded-2xl bg-accent-500/10 p-3 text-accent-300">{icon}</div>
    <h2 className="text-xl font-semibold text-zinc-100">{title}</h2>
    {description ? <p className="mt-3 text-sm text-zinc-500">{description}</p> : null}
    {action ? <div className="mt-5">{action}</div> : null}
  </div>
);
