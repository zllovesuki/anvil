import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { ErrorBanner } from "@/client/components/ui";

const LOAD_TIMEOUT_MS = 10_000;
const TURNSTILE_UNAVAILABLE_MESSAGE = "Human verification is temporarily unavailable.";

const TURNSTILE_OPTIONS = {
  appearance: "interaction-only" as const,
  refreshExpired: "auto" as const,
  refreshTimeout: "auto" as const,
  responseField: false,
  size: "flexible" as const,
  theme: "dark" as const,
};

interface TurnstileWidgetProps {
  action: string;
  onTokenChange: (token: string | null) => void;
  resetKey: number;
  siteKey: string;
}

export const TurnstileWidget = ({ action, onTokenChange, resetKey, siteKey }: TurnstileWidgetProps) => {
  const turnstileRef = useRef<TurnstileInstance>(null);
  const previousResetKeyRef = useRef(resetKey);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const notifyTokenChange = useEffectEvent((token: string | null) => {
    onTokenChange(token);
  });

  const handleLoadTimeout = useEffectEvent(() => {
    onTokenChange(null);
    setMessage(TURNSTILE_UNAVAILABLE_MESSAGE);
  });

  const handleSuccess = useCallback(
    (token: string) => {
      setMessage(null);
      onTokenChange(token);
    },
    [onTokenChange],
  );

  const handleTokenCleared = useCallback(() => {
    setMessage(null);
    onTokenChange(null);
  }, [onTokenChange]);

  const handleUnavailable = useCallback(() => {
    setMessage(TURNSTILE_UNAVAILABLE_MESSAGE);
    onTokenChange(null);
  }, [onTokenChange]);

  const handleWidgetLoad = useCallback(() => {
    setLoaded(true);
    setMessage(null);
  }, []);

  useEffect(() => {
    if (loaded) return;

    const timeout = window.setTimeout(() => {
      handleLoadTimeout();
    }, LOAD_TIMEOUT_MS);

    return () => window.clearTimeout(timeout);
  }, [loaded]);

  useEffect(() => {
    if (resetKey === previousResetKeyRef.current) {
      return;
    }

    previousResetKeyRef.current = resetKey;
    setMessage(null);
    notifyTokenChange(null);
    turnstileRef.current?.reset();
  }, [resetKey]);

  return (
    <div className="space-y-2">
      <Turnstile
        id={`turnstile-${action}`}
        ref={turnstileRef}
        siteKey={siteKey}
        options={{ ...TURNSTILE_OPTIONS, action }}
        onWidgetLoad={handleWidgetLoad}
        onSuccess={handleSuccess}
        onExpire={handleTokenCleared}
        onError={handleTokenCleared}
        onTimeout={handleTokenCleared}
        onUnsupported={handleUnavailable}
      />
      {message ? <ErrorBanner message={message} className="p-3" /> : null}
    </div>
  );
};
