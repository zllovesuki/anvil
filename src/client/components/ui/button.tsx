import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-500 active:scale-[0.98] transition-transform",
  secondary:
    "border border-zinc-700/60 bg-zinc-800/60 text-zinc-300 hover:bg-zinc-700/60 hover:text-zinc-100 active:scale-[0.98] transition-transform",
  danger:
    "border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 active:scale-[0.98] transition-transform",
  ghost: "text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100 active:scale-[0.97] transition-transform",
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

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const ButtonLink = ({ variant = "secondary", size = "md", className, children, ...rest }: ButtonLinkProps) => (
  <Link
    className={[
      "inline-flex items-center justify-center gap-2 font-medium",
      SIZE_CLASSES[size],
      VARIANT_CLASSES[variant],
      className,
    ]
      .filter(Boolean)
      .join(" ")}
    {...rest}
  >
    {children}
  </Link>
);
