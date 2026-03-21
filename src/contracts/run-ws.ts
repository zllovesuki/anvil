import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import { LogEvent } from "@/contracts/log";
import { RunExecutionState, RunStep } from "@/contracts/run";

export const RunWsLogMessage = eg.exactStrict(
  eg.object({
    type: eg.literal("log"),
    event: LogEvent,
  }),
);
export type RunWsLogMessage = TypeFromCodec<typeof RunWsLogMessage>;

export const RunWsStateMessage = eg.exactStrict(
  eg.object({
    type: eg.literal("state"),
    run: RunExecutionState,
    steps: eg.array(RunStep),
  }),
);
export type RunWsStateMessage = TypeFromCodec<typeof RunWsStateMessage>;

export type RunWsMessage = RunWsLogMessage | RunWsStateMessage;
