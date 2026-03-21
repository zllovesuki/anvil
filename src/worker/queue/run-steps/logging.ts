import { parseSSEStream, type ExecutionSession, type LogEvent } from "@cloudflare/sandbox";

import type { LogStream } from "@/contracts";
import type { LogAppendEvent } from "@/worker/contracts";

import { logger, now, type RunExecutionContext } from "@/worker/queue/run-execution-context";

type RunLoggingContext = Pick<RunExecutionContext, "runStore" | "scope">;

export interface ProcessLogSnapshot {
  stdout: string;
  stderr: string;
}

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

export const createProcessLogCollector = (
  session: ExecutionSession,
  processId: string,
  batcher: LogBatcher,
  context: RunLoggingContext,
) => {
  let closed = false;
  const seenChars = {
    stdout: 0,
    stderr: 0,
  };

  const appendChunk = (stream: Exclude<LogStream, "system">, chunk: string): void => {
    if (closed || chunk.length === 0) {
      return;
    }

    batcher.push(stream, chunk);
    seenChars[stream] += chunk.length;
  };

  const backfillSnapshot = async (snapshot: ProcessLogSnapshot): Promise<ProcessLogSnapshot> => {
    const stdoutSuffix = snapshot.stdout.slice(seenChars.stdout);
    if (stdoutSuffix.length > 0) {
      batcher.push("stdout", stdoutSuffix);
    }
    seenChars.stdout = Math.max(seenChars.stdout, snapshot.stdout.length);

    const stderrSuffix = snapshot.stderr.slice(seenChars.stderr);
    if (stderrSuffix.length > 0) {
      batcher.push("stderr", stderrSuffix);
    }
    seenChars.stderr = Math.max(seenChars.stderr, snapshot.stderr.length);

    await batcher.flush();
    return snapshot;
  };

  const streamPromise = (async () => {
    const stream = await session.streamProcessLogs(processId);
    for await (const event of parseSSEStream<LogEvent>(stream)) {
      switch (event.type) {
        case "stdout":
          if (event.data) {
            appendChunk("stdout", event.data);
          }
          break;
        case "stderr":
          if (event.data) {
            appendChunk("stderr", event.data);
          }
          break;
        case "exit":
          return;
        case "error":
          throw new Error(event.data || `Process log stream failed for ${processId}.`);
      }
    }
  })();

  const handledStreamPromise = streamPromise.catch((error) => {
    logger.warn("run_process_log_stream_failed", {
      ...context.scope.logContext,
      processId,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return {
    async complete(options?: { waitForStream?: boolean }): Promise<ProcessLogSnapshot> {
      if (options?.waitForStream ?? true) {
        await handledStreamPromise;
      } else {
        closed = true;
      }

      const snapshot = await session.getProcessLogs(processId);
      const backfilled = await backfillSnapshot({
        stdout: snapshot.stdout,
        stderr: snapshot.stderr,
      });
      closed = true;
      return backfilled;
    },
  };
};
