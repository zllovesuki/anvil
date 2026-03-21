import type { ReactNode } from "react";

type BadgeVariant = "default" | "accent" | "success" | "error" | "warning";

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "border-zinc-800/60 bg-zinc-950/60 text-zinc-500",
  accent: "border-accent-500/20 bg-accent-500/10 text-accent-400",
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  error: "border-red-500/20 bg-red-500/10 text-red-400",
  warning: "border-amber-500/20 bg-amber-500/10 text-amber-300",
};

export const Badge = ({ variant = "default", children, className }: BadgeProps) => (
  <span
    className={[
      "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em]",
      VARIANT_CLASSES[variant],
      className,
    ]
      .filter(Boolean)
      .join(" ")}
  >
    {children}
  </span>
);
