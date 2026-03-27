import type { HTMLAttributes, ReactNode } from "react";

type CardVariant = "default" | "accent";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  interactive?: boolean;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default: "border-zinc-800/60 bg-zinc-900/50",
  accent: "border-accent-500/20 bg-gradient-to-br from-zinc-900/80 to-zinc-900/40",
};

export const Card = ({ variant = "default", interactive = false, children, className, ...rest }: CardProps) => (
  <div
    className={[
      "rounded-2xl border p-5 sm:p-6",
      VARIANT_CLASSES[variant],
      interactive && "hover:-translate-y-0.5 transition-transform cursor-pointer",
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    {children}
  </div>
);
