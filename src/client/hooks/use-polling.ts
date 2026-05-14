import { useEffect, useEffectEvent } from "react";

interface UsePollingOptions {
  enabled: boolean;
  intervalMs: number;
  callback(): void | Promise<void>;
}

export const usePolling = ({ enabled, intervalMs, callback }: UsePollingOptions): void => {
  const runCallback = useEffectEvent(callback);

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      void runCallback();
    }, intervalMs);

    return () => clearInterval(interval);
  }, [enabled, intervalMs]);
};
