import type { LogStream } from "@/contracts";
import type { LogAppendEvent } from "@/worker/contracts";

import { now, type RunExecutionContext } from "@/worker/dispatch/shared/run-execution-context";

type RunLoggingContext = Pick<RunExecutionContext, "runStore" | "scope">;

export interface LogBatcher {
  push(stream: Exclude<LogStream, "system">, chunk: string): void;
  flush(): Promise<void>;
}

export const createLogBatcher = (context: RunLoggingContext): LogBatcher => {
  const buffer: LogAppendEvent[] = [];
  let bufferedBytes = 0;
  let inFlightFlush: Promise<void> | null = null;

  const startFlush = (): Promise<void> => {
    if (inFlightFlush) {
      return inFlightFlush;
    }

    inFlightFlush = (async () => {
      try {
        while (buffer.length > 0) {
          const events = buffer.splice(0, buffer.length);
          bufferedBytes = 0;
          await context.runStore.appendLogs(events);
        }
      } finally {
        inFlightFlush = null;
        if (buffer.length > 0) {
          void startFlush();
        }
      }
    })();

    return inFlightFlush;
  };

  return {
    push(stream: Exclude<LogStream, "system">, chunk: string) {
      if (chunk.length === 0) {
        return;
      }

      buffer.push({
        stream,
        chunk,
        createdAt: now(),
      });
      bufferedBytes += new TextEncoder().encode(chunk).length;

      if (bufferedBytes >= 4096) {
        void startFlush();
      }
    },
    async flush() {
      if (buffer.length > 0) {
        await startFlush();
      }

      while (inFlightFlush) {
        await inFlightFlush;
      }
    },
  };
};
