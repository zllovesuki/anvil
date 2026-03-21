import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastContextValue {
  pushToast(input: Omit<Toast, "id">): void;
}

const TOAST_TIMEOUT_MS = 4000;
const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_STYLES: Record<
  ToastTone,
  {
    panel: string;
    icon: typeof CheckCircle2;
  }
> = {
  success: {
    panel: "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
    icon: CheckCircle2,
  },
  error: {
    panel: "border-red-500/20 bg-red-500/10 text-red-100",
    icon: AlertCircle,
  },
  info: {
    panel: "border-accent-500/20 bg-accent-500/10 text-accent-100",
    icon: Info,
  },
};

const createToastId = (): string => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<string, number>>(new Map());

  const dismissToast = useCallback((id: string) => {
    timersRef.current.delete(id);
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  useEffect(() => {
    return () => {
      for (const handle of timersRef.current.values()) {
        window.clearTimeout(handle);
      }
    };
  }, []);

  const pushToast = useCallback(
    (input: Omit<Toast, "id">) => {
      const id = createToastId();
      setToasts((current) => [...current, { ...input, id }]);
      if (input.tone !== "error") {
        const handle = window.setTimeout(() => dismissToast(id), TOAST_TIMEOUT_MS);
        timersRef.current.set(id, handle);
      }
    },
    [dismissToast],
  );

  const value: ToastContextValue = { pushToast };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3"
      >
        {toasts.map((toast) => {
          const meta = TONE_STYLES[toast.tone];
          const Icon = meta.icon;

          return (
            <div
              key={toast.id}
              className={[
                "animate-slide-up rounded-2xl border p-4 shadow-2xl shadow-black/30 backdrop-blur-xl",
                meta.panel,
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{toast.title}</p>
                  {toast.message ? <p className="mt-1 text-sm text-current/80">{toast.message}</p> : null}
                </div>
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="shrink-0 rounded-lg p-1 text-current/60 transition-colors hover:text-current"
                  onClick={() => dismissToast(toast.id)}
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within ToastProvider.");
  }

  return value;
};
