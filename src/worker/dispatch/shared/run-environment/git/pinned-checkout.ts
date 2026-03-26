import type { ExecutionSession } from "@cloudflare/sandbox";

import type { CommitSha as CommitShaType } from "@/contracts";

import {
  checkoutPinnedCommit,
  fetchPinnedCommitBySha,
  hasCommitObject,
  resolveCheckedOutCommitSha,
  resolveShallowRepositoryState,
  unshallowRepository,
} from "./commands";

const PINNED_COMMIT_SHALLOW_FETCH_DEPTHS = [2, 4, 8, 16, 32, 64] as const;

export const ensurePinnedCommitCheckout = async (
  session: ExecutionSession,
  repoRoot: string,
  commitSha: CommitShaType,
  hasAuthHeader: boolean,
): Promise<void> => {
  let commitAvailable = await hasCommitObject(session, repoRoot, commitSha);
  let repositoryIsShallow = true;

  if (!commitAvailable) {
    await fetchPinnedCommitBySha(
      session,
      repoRoot,
      commitSha,
      hasAuthHeader,
      1,
      `Failed to fetch pinned commit ${commitSha} at depth 1.`,
    );
    commitAvailable = await hasCommitObject(session, repoRoot, commitSha);
    if (!commitAvailable) {
      repositoryIsShallow = await resolveShallowRepositoryState(session, repoRoot);
    }
  }

  for (const depth of PINNED_COMMIT_SHALLOW_FETCH_DEPTHS) {
    if (commitAvailable || !repositoryIsShallow) {
      break;
    }

    await fetchPinnedCommitBySha(
      session,
      repoRoot,
      commitSha,
      hasAuthHeader,
      depth,
      `Failed to deepen checkout to depth ${depth} for pinned commit ${commitSha}.`,
    );
    commitAvailable = await hasCommitObject(session, repoRoot, commitSha);
    if (!commitAvailable) {
      repositoryIsShallow = await resolveShallowRepositoryState(session, repoRoot);
    }
  }

  if (!commitAvailable) {
    if (repositoryIsShallow) {
      await fetchPinnedCommitBySha(session, repoRoot, commitSha, hasAuthHeader);
      commitAvailable = await hasCommitObject(session, repoRoot, commitSha);

      if (!commitAvailable) {
        repositoryIsShallow = await resolveShallowRepositoryState(session, repoRoot);
      }
    }

    if (!commitAvailable && repositoryIsShallow) {
      await unshallowRepository(session, repoRoot, hasAuthHeader);
      commitAvailable = await hasCommitObject(session, repoRoot, commitSha);
    }
  }

  if (!commitAvailable) {
    throw new Error(`Pinned commit ${commitSha} is not available after fetch.`);
  }

  await checkoutPinnedCommit(session, repoRoot, commitSha);
};

export const ensurePinnedCheckoutDepth = async (
  session: ExecutionSession,
  repoRoot: string,
  commitSha: CommitShaType,
  depth: number | undefined,
  hasAuthHeader: boolean,
): Promise<void> => {
  if (!depth || depth <= 1) {
    return;
  }

  if (!(await resolveShallowRepositoryState(session, repoRoot))) {
    return;
  }

  await fetchPinnedCommitBySha(
    session,
    repoRoot,
    commitSha,
    hasAuthHeader,
    depth,
    `Failed to deepen pinned checkout to depth ${depth}.`,
  );

  const checkedOutCommitSha = await resolveCheckedOutCommitSha(session, repoRoot);
  if (checkedOutCommitSha !== commitSha) {
    throw new Error(`Pinned checkout drifted from ${commitSha} to ${checkedOutCommitSha} after depth expansion.`);
  }
};
