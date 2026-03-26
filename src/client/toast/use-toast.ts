import { useContext } from "react";
import { ToastContext, type ToastContextValue } from "@/client/toast/toast-context";

export const useToast = (): ToastContextValue => {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within ToastProvider.");
  }

  return value;
};
