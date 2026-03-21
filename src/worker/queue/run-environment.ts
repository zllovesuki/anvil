import type { CommitSha as CommitShaType } from "@/contracts";
import type { ReplaceRunStepsInput, RepoConfig } from "@/worker/contracts";
import { decryptSecret } from "@/worker/security/secrets";
import { buildGitCheckoutAuth, parseRepoConfigFile, resolveWorkingDirectory } from "@/worker/sandbox";
import {
  logger,
  toPositiveInteger,
  type PreparedExecutionEnvironment,
  type RunExecutionContext,
} from "@/worker/queue/run-execution-context";
import type { RunLeaseControl } from "@/worker/queue/run-lease";
import {
  addOriginRemote,
  ensureBranchCheckout,
  ensureBranchCheckoutDepth,
  ensurePinnedCheckoutDepth,
  ensurePinnedCommitCheckout,
  initializeRepository,
  resolveCheckedOutCommitSha,
} from "./run-environment/git";

type RunEnvironmentContext = Pick<
  RunExecutionContext,
  "control" | "projectControl" | "runStore" | "runtime" | "scope" | "state"
>;

const decodeFileText = (content: string | Uint8Array): string =>
  typeof content === "string" ? content : new TextDecoder().decode(content);

const buildReplaceStepsInput = (repoConfig: RepoConfig): Omit<ReplaceRunStepsInput, "runId"> => ({
  steps: repoConfig.run.steps.map((step, index) => ({
    position: toPositiveInteger(index + 1),
    name: step.name,
    command: step.run,
  })),
});

export const prepareExecutionEnvironment = async (
  context: RunEnvironmentContext,
  lease: RunLeaseControl,
): Promise<PreparedExecutionEnvironment | null> => {
  context.state.phase = "checking_out";
  const checkoutToken = context.scope.executionMaterial.encryptedRepoToken
    ? await decryptSecret(context.scope.env, context.scope.executionMaterial.encryptedRepoToken)
    : null;
  const checkoutAuth = buildGitCheckoutAuth(context.scope.snapshot.repoUrl, checkoutToken);
  context.state.redactionSecrets = checkoutAuth.redactionSecrets;
  await context.runtime.sandbox.setKeepAlive(true);
  const checkoutSession = await context.runtime.sandbox.createSession({
    cwd: "/workspace",
    env: checkoutAuth.sessionEnv,
  });
  context.state.session = checkoutSession;
  let repoConfig: RepoConfig | null = null;
  let workingDirectory = context.scope.repoRoot;
  try {
    await lease.applyCancellationIfNeeded();
    lease.throwIfOwnershipLost();
    if (!lease.isCancellationRequested()) {
      let commitSha: CommitShaType;
      if (context.scope.snapshot.commitSha === null) {
        await ensureBranchCheckout(
          checkoutSession,
          context.scope.repoRoot,
          context.scope.snapshot.repoUrl,
          context.scope.snapshot.branch,
          checkoutAuth.hasAuthHeader,
        );
        commitSha = await resolveCheckedOutCommitSha(checkoutSession, context.scope.repoRoot);
      } else {
        await initializeRepository(checkoutSession, context.scope.repoRoot);
        await addOriginRemote(checkoutSession, context.scope.repoRoot, context.scope.snapshot.repoUrl);
        await ensurePinnedCommitCheckout(
          checkoutSession,
          context.scope.repoRoot,
          context.scope.snapshot.commitSha,
          checkoutAuth.hasAuthHeader,
        );
        commitSha = await resolveCheckedOutCommitSha(checkoutSession, context.scope.repoRoot);
        if (commitSha !== context.scope.snapshot.commitSha) {
          throw new Error(`Pinned checkout resolved ${commitSha}, expected ${context.scope.snapshot.commitSha}.`);
        }
      }
      await lease.applyCancellationIfNeeded();
      lease.throwIfOwnershipLost();
      const recordResult = await context.projectControl.recordResolvedCommit(commitSha);
      if (recordResult.kind === "stale") {
        context.control.markOwnershipLost(recordResult.status);
        lease.throwIfOwnershipLost();
      }
      lease.throwIfOwnershipLost();
      const configFile = await checkoutSession.readFile(
        `${context.scope.repoRoot}/${context.scope.snapshot.configPath}`,
      );
      repoConfig = parseRepoConfigFile(decodeFileText(configFile.content));
      workingDirectory = resolveWorkingDirectory(context.scope.repoRoot, repoConfig.run.workingDirectory);
      if (context.scope.snapshot.commitSha === null) {
        await ensureBranchCheckoutDepth(
          checkoutSession,
          context.scope.repoRoot,
          context.scope.snapshot.branch,
          repoConfig.checkout.depth,
          checkoutAuth.hasAuthHeader,
        );
      } else {
        await ensurePinnedCheckoutDepth(
          checkoutSession,
          context.scope.repoRoot,
          commitSha,
          repoConfig.checkout.depth,
          checkoutAuth.hasAuthHeader,
        );
      }
      lease.throwIfOwnershipLost();
    }
  } finally {
    if (context.state.session === checkoutSession) {
      context.state.session = null;
    }
    try {
      await context.runtime.sandbox.deleteSession(checkoutSession.id);
    } catch (error) {
      logger.warn("checkout_session_delete_failed", {
        ...context.scope.logContext,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (repoConfig === null) {
    if (!lease.isCancellationRequested()) {
      throw new Error(`Repository config was not loaded for run ${context.scope.runId}.`);
    }
    return null;
  }
  if (!lease.isCancellationRequested()) {
    context.state.session = await context.runtime.sandbox.createSession({
      cwd: workingDirectory,
    });
    await lease.applyCancellationIfNeeded();
    lease.throwIfOwnershipLost();
  }
  await context.runStore.replaceSteps(buildReplaceStepsInput(repoConfig));
  return {
    repoConfig,
    workingDirectory,
  };
};
