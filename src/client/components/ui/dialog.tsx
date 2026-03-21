import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useFocusTrap } from "@/client/hooks";

interface DialogProps {
  open: boolean;
  onClose(): void;
  title: string;
  description?: string;
  icon?: ReactNode;
  dismissDisabled?: boolean;
  children: ReactNode;
}

const DialogInner = ({ onClose, title, description, icon, dismissDisabled, children }: Omit<DialogProps, "open">) => {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useFocusTrap(panelRef);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (dismissDisabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dismissDisabled, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={dismissDisabled ? undefined : onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className="relative z-10 w-full max-w-lg rounded-2xl border border-zinc-800/60 bg-zinc-900 p-6 shadow-2xl shadow-black/40"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {icon ? (
              <div aria-hidden="true" className="rounded-xl bg-accent-500/10 p-2 text-accent-300">
                {icon}
              </div>
            ) : null}
            <div>
              <h3 id={titleId} className="text-lg font-semibold text-zinc-100">
                {title}
              </h3>
              {description ? (
                <p id={descId} className="text-sm text-zinc-500">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          {dismissDisabled ? null : (
            <button
              type="button"
              aria-label="Close"
              className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
              onClick={onClose}
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
};

export const Dialog = ({ open, ...rest }: DialogProps) => {
  if (!open) return null;
  return <DialogInner {...rest} />;
};
