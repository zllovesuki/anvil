import { createContext } from "react";

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

export interface ToastContextValue {
  pushToast(input: Omit<Toast, "id">): void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);
