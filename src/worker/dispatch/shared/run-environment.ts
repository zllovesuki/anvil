import type { CommitSha as CommitShaType } from "@/contracts";
import type { ReplaceRunStepsInput, RepoConfig } from "@/worker/contracts";
import { decryptSecret } from "@/worker/security/secrets";
import { buildGitCheckoutAuth, parseRepoConfigFile, resolveWorkingDirectory } from "@/worker/sandbox";
import {
  logger,
  toPositiveInteger,
  type PreparedExecutionEnvironment,
  type RunExecutionContext,
} from "@/worker/dispatch/shared/run-execution-context";
import type { RunLeaseControl } from "@/worker/dispatch/shared/run-lease";
import { deleteSandboxSessionIfExists, getOrCreateSandboxSession } from "@/worker/dispatch/shared/sandbox-errors";
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

interface PrepareExecutionEnvironmentOptions {
  executionSessionId?: string;
}

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
  options: PrepareExecutionEnvironmentOptions = {},
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
      const persistedCommitSha = context.scope.snapshot.commitSha ?? (await context.runStore.getMeta()).commitSha;
      let commitSha: CommitShaType;
      if (persistedCommitSha === null) {
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
          persistedCommitSha,
          checkoutAuth.hasAuthHeader,
        );
        commitSha = await resolveCheckedOutCommitSha(checkoutSession, context.scope.repoRoot);
        if (commitSha !== persistedCommitSha) {
          throw new Error(`Pinned checkout resolved ${commitSha}, expected ${persistedCommitSha}.`);
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
      if (persistedCommitSha === null) {
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
      await deleteSandboxSessionIfExists(context.runtime.sandbox, checkoutSession.id);
    } catch (error) {
      logger.warn("checkout_session_delete_failed", {
        ...context.scope.logContext,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      context.runtime.disposeSession(checkoutSession);
    }
  }
  if (repoConfig === null) {
    if (!lease.isCancellationRequested()) {
      throw new Error(`Repository config was not loaded for run ${context.scope.runId}.`);
    }
    return null;
  }
  if (!lease.isCancellationRequested()) {
    if (options.executionSessionId) {
      context.state.session = await getOrCreateSandboxSession(context.runtime, {
        id: options.executionSessionId,
        cwd: workingDirectory,
      });
    } else {
      context.state.session = await context.runtime.sandbox.createSession({
        cwd: workingDirectory,
      });
    }
    await lease.applyCancellationIfNeeded();
    lease.throwIfOwnershipLost();
  }
  await context.runStore.replaceSteps(buildReplaceStepsInput(repoConfig));
  return {
    repoConfig,
    workingDirectory,
  };
};
