import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ErrorBanner } from "@/client/components/ui";

const TURNSTILE_SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const TURNSTILE_UNAVAILABLE_MESSAGE = "Human verification is temporarily unavailable.";

interface TurnstileRenderOptions {
  action: string;
  appearance: "always" | "execute" | "interaction-only";
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  sitekey: string;
  size: "normal" | "compact" | "flexible";
  theme: "auto" | "light" | "dark";
}

interface TurnstileApi {
  remove(widgetId: string): void;
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let turnstileScriptPromise: Promise<TurnstileApi> | null = null;

const loadTurnstileScript = (): Promise<TurnstileApi> => {
  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }

  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  turnstileScriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SCRIPT_SRC}"]`);

    const handleLoad = () => {
      if (window.turnstile) {
        resolve(window.turnstile);
        return;
      }

      turnstileScriptPromise = null;
      reject(new Error(TURNSTILE_UNAVAILABLE_MESSAGE));
    };

    const handleError = () => {
      turnstileScriptPromise = null;
      reject(new Error(TURNSTILE_UNAVAILABLE_MESSAGE));
    };

    if (existingScript) {
      existingScript.addEventListener("load", handleLoad, { once: true });
      existingScript.addEventListener("error", handleError, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    document.head.appendChild(script);
  });

  return turnstileScriptPromise;
};

interface TurnstileWidgetProps {
  action: string;
  onTokenChange: (token: string | null) => void;
  resetKey: number;
  siteKey: string;
}

export const TurnstileWidget = ({ action, onTokenChange, resetKey, siteKey }: TurnstileWidgetProps) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const previousResetKeyRef = useRef(resetKey);
  const notifyTokenChange = useEffectEvent((token: string | null) => {
    onTokenChange(token);
  });

  const [turnstile, setTurnstile] = useState<TurnstileApi | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    notifyTokenChange(null);

    void loadTurnstileScript()
      .then((nextTurnstile) => {
        if (!active) {
          return;
        }

        setTurnstile(nextTurnstile);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        notifyTokenChange(null);
        setMessage(error instanceof Error ? error.message : TURNSTILE_UNAVAILABLE_MESSAGE);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current || !turnstile || widgetIdRef.current) {
      return;
    }

    try {
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        appearance: "interaction-only",
        theme: "dark",
        size: "flexible",
        callback: (token) => {
          setMessage(null);
          notifyTokenChange(token);
        },
        "error-callback": () => {
          // Turnstile retries transient client-side failures automatically.
          setMessage(null);
          notifyTokenChange(null);
        },
        "expired-callback": () => {
          setMessage(null);
          notifyTokenChange(null);
        },
      });
    } catch {
      notifyTokenChange(null);
      queueMicrotask(() => setMessage(TURNSTILE_UNAVAILABLE_MESSAGE));
    }

    return () => {
      if (widgetIdRef.current) {
        turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [action, siteKey, turnstile]);

  useEffect(() => {
    if (!turnstile || !widgetIdRef.current) {
      previousResetKeyRef.current = resetKey;
      return;
    }

    if (resetKey === previousResetKeyRef.current) {
      return;
    }

    previousResetKeyRef.current = resetKey;
    setMessage(null);
    notifyTokenChange(null);
    turnstile.reset(widgetIdRef.current);
  }, [resetKey, turnstile]);

  return (
    <div className="space-y-2">
      <div ref={containerRef} />
      {message ? <ErrorBanner message={message} className="p-3" /> : null}
    </div>
  );
};
