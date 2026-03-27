import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Input = ({ label, helperText, error, className, id, ...rest }: InputProps) => {
  const inputId = id ?? (label ? `input-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);
  const errorId = inputId ? `${inputId}-error` : undefined;
  const helperId = inputId ? `${inputId}-helper` : undefined;

  return (
    <label className="block" htmlFor={inputId}>
      {label ? <span className="mb-2 block text-sm font-medium text-zinc-300">{label}</span> : null}
      <input
        id={inputId}
        className={[
          "w-full rounded-xl border bg-zinc-800/80 px-4 py-2.5 text-zinc-100 transition-colors placeholder:text-zinc-500 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
          error
            ? "border-red-500/50 focus:border-red-500/70 focus:ring-1 focus:ring-red-500/30"
            : "border-zinc-700/60 focus:border-accent-500/50 focus:ring-1 focus:ring-accent-500/30",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? errorId : helperText ? helperId : undefined}
      />
      {error ? (
        <span id={errorId} className="mt-2 block text-xs text-red-400">
          {error}
        </span>
      ) : helperText ? (
        <span id={helperId} className="mt-2 block text-xs text-zinc-500">
          {helperText}
        </span>
      ) : null}
    </label>
  );
};
