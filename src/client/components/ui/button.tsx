import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-r from-accent-500 to-accent-600 text-white shadow-sm shadow-accent-500/10 transition-[color,background-color,box-shadow] hover:shadow-md hover:shadow-accent-500/15",
  secondary:
    "border border-zinc-700/60 bg-zinc-800/60 text-zinc-300 transition-colors hover:bg-zinc-700/60 hover:text-zinc-100",
  danger:
    "border border-red-500/20 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300",
  ghost: "text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-100",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "rounded-lg px-3 py-1.5 text-xs",
  md: "rounded-xl px-4 py-2.5 text-sm",
};

export const Button = ({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  children,
  disabled,
  className,
  ...rest
}: ButtonProps) => (
  <button
    type="button"
    disabled={disabled || loading}
    className={[
      "inline-flex items-center justify-center gap-2 font-medium disabled:cursor-not-allowed disabled:opacity-50",
      SIZE_CLASSES[size],
      VARIANT_CLASSES[variant],
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    {icon}
    {loading ? "Loading..." : children}
  </button>
);
