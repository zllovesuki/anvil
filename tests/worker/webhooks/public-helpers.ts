import {
  CommitSha,
  UnixTimestampMs,
  type BranchName as BranchNameValue,
  type ProjectId,
  RunId,
  type UserId,
} from "@/contracts";
import { expectTrusted } from "@/worker/contracts";
import { acceptManualRunWithoutAlarm } from "../../helpers/project-do";
import { getProjectStub } from "../../helpers/runtime";

export const BEFORE_SHA = "1111111111111111111111111111111111111111";
export const AFTER_SHA = "2222222222222222222222222222222222222222";
export const THIRD_SHA = "3333333333333333333333333333333333333333";

export const buildVerifiedPushDeliveryInput = (input: {
  projectId: ProjectId;
  repoUrl: string;
  deliveryId: string;
  branch: BranchNameValue;
  verifiedWebhookUpdatedAt: number;
}) => ({
  projectId: input.projectId,
  payload: {
    provider: "github" as const,
    deliveryId: input.deliveryId,
    eventKind: "push" as const,
    eventName: "push",
    repoUrl: input.repoUrl,
    ref: "refs/heads/main",
    branch: input.branch,
    commitSha: expectTrusted(CommitSha, AFTER_SHA, "CommitSha"),
    beforeSha: expectTrusted(CommitSha, BEFORE_SHA, "CommitSha"),
  },
  outcome: "accepted" as const,
  verifiedWebhookUpdatedAt: expectTrusted(UnixTimestampMs, input.verifiedWebhookUpdatedAt, "UnixTimestampMs"),
});

export const fillProjectQueueToCapacity = async (input: {
  projectId: ProjectId;
  userId: UserId;
  branch: BranchNameValue;
}): Promise<void> => {
  for (let index = 0; index < 20; index += 1) {
    await acceptManualRunWithoutAlarm(getProjectStub(input.projectId), {
      projectId: input.projectId,
      triggeredByUserId: input.userId,
      branch: input.branch,
    });
  }
};

export const freeOneQueuedSlot = async (projectId: ProjectId, runId: string): Promise<void> => {
  const claim = await getProjectStub(projectId).claimRunWork({
    projectId,
    runId: expectTrusted(RunId, runId, "RunId"),
  });
  if (claim.kind !== "execute") {
    throw new Error(`Expected queued slot release claim to execute, got ${claim.kind}.`);
  }

  await getProjectStub(projectId).finalizeRunExecution({
    projectId,
    runId: expectTrusted(RunId, runId, "RunId"),
    terminalStatus: "failed",
    lastError: "capacity_freed_for_webhook_resend",
    sandboxDestroyed: true,
  });
};
