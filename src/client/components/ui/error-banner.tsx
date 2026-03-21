interface ErrorBannerProps {
  message: string;
  className?: string;
}

export const ErrorBanner = ({ message, className }: ErrorBannerProps) => (
  <div
    role="alert"
    className={["rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400", className]
      .filter(Boolean)
      .join(" ")}
  >
    {message}
  </div>
);
