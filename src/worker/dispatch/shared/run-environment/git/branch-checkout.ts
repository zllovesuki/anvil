import type { ExecutionSession } from "@cloudflare/sandbox";

import {
  addOriginRemote,
  checkoutFetchedBranch,
  fetchBranch,
  initializeRepository,
  resolveShallowRepositoryState,
  setFetchedBranchUpstream,
} from "./commands";

export const ensureBranchCheckout = async (
  session: ExecutionSession,
  repoRoot: string,
  repoUrl: string,
  branch: string,
  hasAuthHeader: boolean,
): Promise<void> => {
  await initializeRepository(session, repoRoot);
  await addOriginRemote(session, repoRoot, repoUrl);
  await fetchBranch(session, repoRoot, branch, hasAuthHeader, 1, `Failed to fetch branch ${branch} at depth 1.`);
  await checkoutFetchedBranch(session, repoRoot, branch);
  await setFetchedBranchUpstream(session, repoRoot, branch);
};

export const ensureBranchCheckoutDepth = async (
  session: ExecutionSession,
  repoRoot: string,
  branch: string,
  depth: number | undefined,
  hasAuthHeader: boolean,
): Promise<void> => {
  if (!depth || depth <= 1) {
    return;
  }

  if (!(await resolveShallowRepositoryState(session, repoRoot))) {
    return;
  }

  await fetchBranch(session, repoRoot, branch, hasAuthHeader, depth, `Failed to deepen checkout to depth ${depth}.`);
};
