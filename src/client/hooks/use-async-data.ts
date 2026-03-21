import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh(): void;
}

export const useAsyncData = <T>(fetcher: () => Promise<T>, deps: unknown[]): AsyncDataResult<T> => {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async (signal: { canceled: boolean }) => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetcherRef.current();
      if (!signal.canceled) {
        setData(result);
      }
    } catch (reason) {
      if (!signal.canceled) {
        setError(reason instanceof Error ? reason.message : "An unexpected error occurred.");
      }
    } finally {
      if (!signal.canceled) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const signal = { canceled: false };
    void load(signal);

    return () => {
      signal.canceled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(() => {
    void load({ canceled: false });
  }, [load]);

  return { data, loading, error, refresh };
};
