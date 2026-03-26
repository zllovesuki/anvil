import {
  parseSSEStream,
  type ExecEvent,
  type ExecutionSession,
  type Process,
  type StreamOptions,
} from "@cloudflare/sandbox";

import type { LogStream } from "@/contracts";

import type { LogBatcher } from "./logging";

export interface CommandStreamResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  terminalEvent: "complete" | "error" | "interrupted";
  errorMessage: string | null;
}

interface CommandStreamHooks {
  onStart?: (event: ExecEvent) => Promise<void> | void;
}

const appendChunk = (
  result: CommandStreamResult,
  batcher: LogBatcher,
  stream: Exclude<LogStream, "system">,
  chunk: string | undefined,
): void => {
  if (!chunk) {
    return;
  }

  batcher.push(stream, chunk);
  result[stream] += chunk;
};

export const executeSessionCommandStream = async (
  session: Pick<ExecutionSession, "execStream">,
  command: string,
  options: StreamOptions | undefined,
  batcher: LogBatcher,
  hooks?: CommandStreamHooks,
): Promise<CommandStreamResult> => {
  const result: CommandStreamResult = {
    stdout: "",
    stderr: "",
    exitCode: null,
    terminalEvent: "interrupted",
    errorMessage: null,
  };

  try {
    const stream = await session.execStream(command, options);
    for await (const event of parseSSEStream<ExecEvent>(stream)) {
      switch (event.type) {
        case "start":
          await hooks?.onStart?.(event);
          break;
        case "stdout":
          appendChunk(result, batcher, "stdout", event.data);
          break;
        case "stderr":
          appendChunk(result, batcher, "stderr", event.data);
          break;
        case "complete":
          result.terminalEvent = "complete";
          result.exitCode = event.exitCode ?? event.result?.exitCode ?? 1;
          break;
        case "error":
          result.terminalEvent = "error";
          result.exitCode = 1;
          result.errorMessage = event.error ?? event.data ?? "Command stream emitted an error event.";
          break;
      }

      if (result.terminalEvent !== "interrupted") {
        break;
      }
    }
  } catch (error) {
    result.errorMessage = error instanceof Error ? error.message : String(error);
  } finally {
    await batcher.flush();
  }

  if (result.terminalEvent === "interrupted" && result.errorMessage === null) {
    result.errorMessage = "Command stream ended without a terminal event.";
  }

  return result;
};

const isLiveProcess = (process: Process): boolean => process.status === "starting" || process.status === "running";

export const resolveExecStreamProcess = async (
  session: Pick<ExecutionSession, "listProcesses">,
  command: string,
  pid?: number,
): Promise<Process | null> => {
  const liveProcesses = (await session.listProcesses()).filter(isLiveProcess);
  if (pid !== undefined) {
    const pidMatch = liveProcesses.find((process) => process.pid === pid);
    if (pidMatch) {
      return pidMatch;
    }
  }

  const commandMatches = liveProcesses
    .filter((process) => process.command === command)
    .sort((left, right) => right.startTime.getTime() - left.startTime.getTime());
  if (commandMatches.length > 0) {
    return commandMatches[0] ?? null;
  }

  const latestLiveProcess = [...liveProcesses].sort(
    (left, right) => right.startTime.getTime() - left.startTime.getTime(),
  );
  return latestLiveProcess[0] ?? null;
};
