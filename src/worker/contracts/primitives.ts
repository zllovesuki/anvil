import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

export const PositiveInteger = eg.brand("PositiveInteger", eg.number, (value) => Number.isInteger(value) && value > 0);
export type PositiveInteger = TypeFromCodec<typeof PositiveInteger>;

export const ProjectRunStatus = eg.union([
  eg.literal("pending"),
  eg.literal("executable"),
  eg.literal("active"),
  eg.literal("cancel_requested"),
  eg.literal("passed"),
  eg.literal("failed"),
  eg.literal("canceled"),
]);
export type ProjectRunStatus = TypeFromCodec<typeof ProjectRunStatus>;

export const ProjectRunTerminalStatus = eg.union([eg.literal("passed"), eg.literal("failed"), eg.literal("canceled")]);
export type ProjectRunTerminalStatus = TypeFromCodec<typeof ProjectRunTerminalStatus>;

export const D1SyncStatus = eg.union([
  eg.literal("needs_create"),
  eg.literal("needs_update"),
  eg.literal("current"),
  eg.literal("needs_terminal_update"),
  eg.literal("done"),
]);
export type D1SyncStatus = TypeFromCodec<typeof D1SyncStatus>;

export const DispatchStatus = eg.union([
  eg.literal("blocked"),
  eg.literal("pending"),
  eg.literal("queued"),
  eg.literal("started"),
  eg.literal("terminal"),
]);
export type DispatchStatus = TypeFromCodec<typeof DispatchStatus>;

export const isTerminalStatus = (status: string): status is ProjectRunTerminalStatus =>
  ProjectRunTerminalStatus.is(status);
