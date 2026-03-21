import { useEffect, useRef } from "react";

interface UsePollingOptions {
  enabled: boolean;
  intervalMs: number;
  callback(): void | Promise<void>;
}

export const usePolling = ({ enabled, intervalMs, callback }: UsePollingOptions): void => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      void callbackRef.current();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [enabled, intervalMs]);
};
