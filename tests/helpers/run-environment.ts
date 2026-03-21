import { vi } from "vitest";

import { type CommitSha as CommitShaType, ProjectId, RunId, UnixTimestampMs } from "@/contracts";
import { type ProjectRunStatus, type RecordRunResolvedCommitResult, expectTrusted } from "@/worker/contracts";
import type { RunExecutionContext } from "@/worker/queue/run-execution-context";

import {
  createQueueProjectControlStub,
  createQueueRunControlStub,
  createQueueRunRuntimeStub,
  createQueueRunStoreStub,
  createQueueScope,
  createQueueState,
  createQueueLeaseStub,
} from "./queue";

type RunEnvironmentHarnessContext = Pick<
  RunExecutionContext,
  "control" | "projectControl" | "runStore" | "runtime" | "scope" | "state"
>;

export type ExecResult = {
  success: boolean;
  stdout: string;
  stderr: string;
};

export const INVALID_REPO_CONFIG = "run:\n  steps: [";
export const VALID_REPO_CONFIG = `version: 1
checkout:
  depth: 3
run:
  workingDirectory: .
  timeoutSeconds: 60
  steps:
    - name: test
      run: echo hello
`;

export const createLeaseStub = createQueueLeaseStub;

export const createExecResult = (overrides: Partial<ExecResult> = {}): ExecResult => ({
  success: true,
  stdout: "",
  stderr: "",
  ...overrides,
});

export const createHarness = ({
  projectIdValue,
  runIdValue,
  snapshotCommitSha,
  recordRunResolvedCommitResult = { kind: "applied" },
  configContent = INVALID_REPO_CONFIG,
  execImpl,
}: {
  projectIdValue: string;
  runIdValue: string;
  snapshotCommitSha: CommitShaType | null;
  recordRunResolvedCommitResult?: RecordRunResolvedCommitResult;
  configContent?: string;
  execImpl: (command: string) => Promise<ExecResult> | ExecResult;
}) => {
  const projectId = ProjectId.assertDecode(projectIdValue);
  const runId = RunId.assertDecode(runIdValue);
  const events: string[] = [];

  const checkoutSession = {
    id: "checkout-session",
    exec: vi.fn(async (command: string) => execImpl(command)),
    readFile: vi.fn(async () => {
      events.push("read-file");
      return {
        content: configContent,
      };
    }),
  };
  const runSession = {
    id: "run-session",
  };

  const recordRunResolvedCommit = vi.fn(
    async (_input: { projectId: ProjectId; runId: RunId; commitSha: CommitShaType }) => {
      events.push("record-run-resolved-commit");
      return recordRunResolvedCommitResult;
    },
  );
  const replaceSteps = vi.fn(async () => {});
  let sessionCreations = 0;

  const sandbox = {
    setKeepAlive: vi.fn(async () => {}),
    createSession: vi.fn(async () => {
      sessionCreations += 1;
      return sessionCreations === 1 ? checkoutSession : runSession;
    }),
    deleteSession: vi.fn(async () => {
      events.push("delete-session");
    }),
  };

  const startedAt = expectTrusted(UnixTimestampMs, Date.now(), "UnixTimestampMs");
  const scope = createQueueScope({
    projectId,
    runId,
    snapshotCommitSha,
    startedAt,
  });
  const state = createQueueState();

  const context: RunEnvironmentHarnessContext = {
    scope,
    state,
    projectControl: createQueueProjectControlStub({
      recordHeartbeat: vi.fn(async () => null),
      recordResolvedCommit: async (commitSha: CommitShaType) =>
        await recordRunResolvedCommit({
          projectId,
          runId,
          commitSha,
        }),
    }),
    runStore: createQueueRunStoreStub({
      replaceSteps,
    }),
    runtime: createQueueRunRuntimeStub({
      sandbox: sandbox as unknown as RunEnvironmentHarnessContext["runtime"]["sandbox"],
    }),
    control: createQueueRunControlStub({
      markOwnershipLost: (status: ProjectRunStatus | null) => {
        state.ownershipLost = true;
        state.ownershipLossStatus = status;
        events.push("ownership-lost");
      },
    }),
  };

  return {
    context,
    events,
    projectId,
    recordRunResolvedCommit,
    replaceSteps,
    runId,
    sandbox,
  };
};
