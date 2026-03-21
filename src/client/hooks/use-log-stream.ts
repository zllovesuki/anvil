import { useEffect, useRef, useState } from "react";
import { RunWsLogMessage, RunWsStateMessage, type LogEvent, type RunWsMessage } from "@/contracts";
import { useAuth } from "@/client/auth";
import { getApiClient } from "@/client/lib";

export interface UseLogStreamOptions {
  runId: string;
  enabled: boolean;
  onEvent: (event: LogEvent) => void;
  onStateUpdate?: (msg: RunWsStateMessage) => void;
}

export type LogStreamStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export const useLogStream = (options: UseLogStreamOptions): LogStreamStatus => {
  const { runId, enabled, onEvent, onStateUpdate } = options;
  const { mode } = useAuth();
  const [status, setStatus] = useState<LogStreamStatus>("idle");

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(1000);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onStateUpdateRef = useRef(onStateUpdate);
  onStateUpdateRef.current = onStateUpdate;

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    let active = true;

    const connect = async () => {
      setStatus("connecting");

      try {
        const client = getApiClient(mode);
        const { ticket } = await client.getLogStreamTicket(runId);

        if (!active) return;

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/api/private/runs/${encodeURIComponent(runId)}/logs?ticket=${encodeURIComponent(ticket)}`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!active) {
            ws.close();
            return;
          }
          setStatus("connected");
          backoffRef.current = 1000;
        };

        ws.onmessage = (event) => {
          if (!active) return;
          try {
            const message = JSON.parse(event.data as string) as RunWsMessage;
            if (message.type === "log") {
              onEventRef.current(message.event);
            } else if (message.type === "state") {
              onStateUpdateRef.current?.(message);
            }
          } catch {
            // ignore malformed messages
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (!active) return;
          setStatus("reconnecting");
          const delay = backoffRef.current;
          backoffRef.current = Math.min(delay * 2, 15000);
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (active) void connect();
          }, delay);
        };

        ws.onerror = () => {
          // onclose always follows onerror — reconnection handled there
        };
      } catch {
        if (!active) return;
        setStatus("reconnecting");
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, 15000);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (active) void connect();
        }, delay);
      }
    };

    void connect();

    return () => {
      active = false;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, runId, mode]);

  return status;
};
