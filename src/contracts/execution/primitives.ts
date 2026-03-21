import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

export const StepStatus = eg.union([
  eg.literal("queued"),
  eg.literal("running"),
  eg.literal("passed"),
  eg.literal("failed"),
]);
export type StepStatus = TypeFromCodec<typeof StepStatus>;

export const LogStream = eg.union([eg.literal("stdout"), eg.literal("stderr"), eg.literal("system")]);
export type LogStream = TypeFromCodec<typeof LogStream>;
