import { eg, type TypeFromCodec } from "@cloudflare/util-en-garde";

export const MAX_REPO_CONFIG_FILE_BYTES = 64 * 1024;

const byteLength = (value: string): number => new TextEncoder().encode(value).length;

const isRepoRelativePath = (value: string): boolean => {
  if (value.length === 0 || value.startsWith("/") || value.startsWith("\\") || value.includes("\\")) {
    return false;
  }

  if (/^[A-Za-z]:\//u.test(value)) {
    return false;
  }

  return value.split("/").every((segment) => segment.length > 0 && segment !== "..");
};

const RepoRelativePath = eg.brand("RepoRelativePath", eg.string, isRepoRelativePath);
const CheckoutDepth = eg.brand("CheckoutDepth", eg.number, (value) => Number.isInteger(value) && value > 0);
const StepName = eg.brand("RepoConfigStepName", eg.string, (value) => byteLength(value) <= 64);
const StepCommand = eg.brand("RepoConfigStepCommand", eg.string, (value) => byteLength(value) <= 4096);
const RunTimeoutSeconds = eg.brand(
  "RunTimeoutSeconds",
  eg.number,
  (value) => Number.isInteger(value) && value > 0 && value <= 720,
);

export const RepoConfigStep = eg.exactStrict(
  eg.object({
    name: StepName,
    run: StepCommand,
  }),
);
export type RepoConfigStep = TypeFromCodec<typeof RepoConfigStep>;

const RepoConfigSteps = eg.brand("RepoConfigSteps", eg.array(RepoConfigStep), (value) => value.length <= 20);

export const RepoConfigCheckout = eg.exactStrict(
  eg.object({
    depth: CheckoutDepth.optional,
  }),
);
export type RepoConfigCheckout = TypeFromCodec<typeof RepoConfigCheckout>;

export const RepoConfigRun = eg.exactStrict(
  eg.object({
    workingDirectory: RepoRelativePath,
    timeoutSeconds: RunTimeoutSeconds,
    steps: RepoConfigSteps,
  }),
);
export type RepoConfigRun = TypeFromCodec<typeof RepoConfigRun>;

export const RepoConfig = eg.exactStrict(
  eg.object({
    version: eg.literal(1),
    checkout: RepoConfigCheckout,
    run: RepoConfigRun,
  }),
);
export type RepoConfig = TypeFromCodec<typeof RepoConfig>;

export const RepoConfigFileText = eg.brand(
  "RepoConfigFileText",
  eg.string,
  (value) => byteLength(value) <= MAX_REPO_CONFIG_FILE_BYTES,
);
export type RepoConfigFileText = TypeFromCodec<typeof RepoConfigFileText>;
