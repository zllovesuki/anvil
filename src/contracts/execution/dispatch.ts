import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

export const DispatchMode = eg.union([eg.literal("queue"), eg.literal("workflows")]);
export type DispatchMode = TypeFromCodec<typeof DispatchMode>;

export const ExecutionRuntime = eg.literal("cloudflare_sandbox");
export type ExecutionRuntime = TypeFromCodec<typeof ExecutionRuntime>;

export const DEFAULT_DISPATCH_MODE: DispatchMode = "queue";
export const DEFAULT_EXECUTION_RUNTIME: ExecutionRuntime = "cloudflare_sandbox";
