import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

import { IsoDateTime, OpaqueId, RunId } from "@/contracts/common";
import { LogStream } from "@/contracts/execution";

export const LogEvent = eg.exactStrict(
  eg.object({
    id: OpaqueId,
    runId: RunId,
    seq: eg.number,
    stream: LogStream,
    chunk: eg.string,
    createdAt: IsoDateTime,
  }),
);
export type LogEvent = TypeFromCodec<typeof LogEvent>;
