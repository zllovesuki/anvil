import type { ReactNode } from "react";

interface PageHeaderProps {
  label?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export const PageHeader = ({ label, title, description, actions }: PageHeaderProps) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      {label ? <p className="text-sm font-medium uppercase tracking-[0.22em] text-accent-300">{label}</p> : null}
      <h1 className={["text-3xl font-semibold tracking-tight text-zinc-100", label ? "mt-2" : ""].join(" ")}>
        {title}
      </h1>
      {description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{description}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
  </div>
);
