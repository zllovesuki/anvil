import type { ExecutionSession } from "@cloudflare/sandbox";

import { CommitSha, type CommitSha as CommitShaType } from "@/contracts";
import { GIT_AUTH_HEADER_ENV } from "@/worker/sandbox/git";

const quoteShellArg = (value: string): string => `'${value.replace(/'/gu, `'\"'\"'`)}'`;
const SHALLOW_UNSUPPORTED_ERROR_PATTERNS = [
  /does not support shallow requests/u,
  /does not support shallow capabilities/u,
  /does not support shallow/u,
  /does not support --depth/u,
] as const;

const buildGitCommandPrefix = (hasAuthHeader: boolean): string =>
  hasAuthHeader
    ? `git -c credential.helper= -c "http.extraHeader=$${GIT_AUTH_HEADER_ENV}"`
    : "git -c credential.helper=";

const isShallowUnsupportedError = (stderr: string): boolean =>
  SHALLOW_UNSUPPORTED_ERROR_PATTERNS.some((pattern) => pattern.test(stderr.toLowerCase()));

const hasCommitObject = async (
  session: ExecutionSession,
  repoRoot: string,
  commitSha: CommitShaType,
): Promise<boolean> => {
  const result = await session.exec(
    `git -C ${quoteShellArg(repoRoot)} cat-file -e ${quoteShellArg(`${commitSha}^{commit}`)}`,
    {
      cwd: repoRoot,
    },
  );

  return result.success;
};

const fetchRef = async (
  session: ExecutionSession,
  repoRoot: string,
  ref: string,
  hasAuthHeader: boolean,
  depth?: number,
  errorMessage?: string,
): Promise<void> => {
  const depthArgs = depth === undefined ? "" : ` --depth=${depth} --update-shallow`;
  let result = await session.exec(
    `${buildGitCommandPrefix(hasAuthHeader)} -C ${quoteShellArg(repoRoot)} fetch${depthArgs} origin ${quoteShellArg(ref)}`,
    {
      cwd: repoRoot,
    },
  );

  if (!result.success && depth !== undefined && isShallowUnsupportedError(result.stderr)) {
    result = await session.exec(
      `${buildGitCommandPrefix(hasAuthHeader)} -C ${quoteShellArg(repoRoot)} fetch origin ${quoteShellArg(ref)}`,
      {
        cwd: repoRoot,
      },
    );
  }

  if (!result.success) {
    throw new Error(result.stderr || errorMessage || `Failed to fetch ${ref}.`);
  }
};

export const initializeRepository = async (session: ExecutionSession, repoRoot: string): Promise<void> => {
  const result = await session.exec(`git init ${quoteShellArg(repoRoot)}`, {
    cwd: "/workspace",
  });

  if (!result.success) {
    throw new Error(result.stderr || `Failed to initialize ${repoRoot}.`);
  }
};

export const addOriginRemote = async (session: ExecutionSession, repoRoot: string, repoUrl: string): Promise<void> => {
  const result = await session.exec(`git -C ${quoteShellArg(repoRoot)} remote add origin ${quoteShellArg(repoUrl)}`, {
    cwd: repoRoot,
  });

  if (!result.success) {
    throw new Error(result.stderr || `Failed to add origin remote for ${repoRoot}.`);
  }
};

export const resolveCheckedOutCommitSha = async (
  session: ExecutionSession,
  repoRoot: string,
): Promise<CommitShaType> => {
  const result = await session.exec(`git -C ${quoteShellArg(repoRoot)} rev-parse HEAD`, {
    cwd: repoRoot,
  });

  if (!result.success) {
    throw new Error(result.stderr || "Failed to resolve checked-out commit SHA.");
  }

  try {
    return CommitSha.assertDecode(result.stdout.trim());
  } catch {
    throw new Error(`Resolved commit SHA was invalid: ${result.stdout.trim()}`);
  }
};

export const resolveShallowRepositoryState = async (session: ExecutionSession, repoRoot: string): Promise<boolean> => {
  const result = await session.exec(`git -C ${quoteShellArg(repoRoot)} rev-parse --is-shallow-repository`, {
    cwd: repoRoot,
  });

  if (!result.success) {
    throw new Error(result.stderr || "Failed to resolve shallow repository state.");
  }

  const normalizedOutput = result.stdout.trim().toLowerCase();
  if (normalizedOutput === "true") {
    return true;
  }
  if (normalizedOutput === "false") {
    return false;
  }

  throw new Error(`Unexpected shallow repository state: ${result.stdout.trim()}`);
};

export const fetchPinnedCommitBySha = async (
  session: ExecutionSession,
  repoRoot: string,
  commitSha: CommitShaType,
  hasAuthHeader: boolean,
  depth?: number,
  errorMessage?: string,
): Promise<void> => {
  await fetchRef(session, repoRoot, commitSha, hasAuthHeader, depth, errorMessage);
};

export const fetchBranch = async (
  session: ExecutionSession,
  repoRoot: string,
  branch: string,
  hasAuthHeader: boolean,
  depth?: number,
  errorMessage?: string,
): Promise<void> => {
  await fetchRef(session, repoRoot, branch, hasAuthHeader, depth, errorMessage);
};

export const unshallowRepository = async (
  session: ExecutionSession,
  repoRoot: string,
  hasAuthHeader: boolean,
): Promise<void> => {
  const fetchResult = await session.exec(
    `${buildGitCommandPrefix(hasAuthHeader)} -C ${quoteShellArg(repoRoot)} fetch --unshallow --update-shallow origin`,
    {
      cwd: repoRoot,
    },
  );

  if (!fetchResult.success) {
    throw new Error(fetchResult.stderr || "Failed to unshallow pinned checkout history.");
  }
};

export const checkoutFetchedBranch = async (
  session: ExecutionSession,
  repoRoot: string,
  branch: string,
): Promise<void> => {
  const checkoutResult = await session.exec(
    `git -C ${quoteShellArg(repoRoot)} checkout -B ${quoteShellArg(branch)} FETCH_HEAD`,
    {
      cwd: repoRoot,
    },
  );
  if (!checkoutResult.success) {
    throw new Error(checkoutResult.stderr || `Failed to check out branch ${branch}.`);
  }
};

export const setFetchedBranchUpstream = async (
  session: ExecutionSession,
  repoRoot: string,
  branch: string,
): Promise<void> => {
  const upstreamRef = `origin/${branch}`;
  const upstreamResult = await session.exec(
    `git -C ${quoteShellArg(repoRoot)} branch --set-upstream-to=${quoteShellArg(upstreamRef)} ${quoteShellArg(branch)}`,
    {
      cwd: repoRoot,
    },
  );
  if (!upstreamResult.success) {
    throw new Error(upstreamResult.stderr || `Failed to set upstream for branch ${branch}.`);
  }
};

export const checkoutPinnedCommit = async (
  session: ExecutionSession,
  repoRoot: string,
  commitSha: CommitShaType,
): Promise<void> => {
  const checkoutResult = await session.exec(
    `git -C ${quoteShellArg(repoRoot)} checkout --detach ${quoteShellArg(commitSha)}`,
    {
      cwd: repoRoot,
    },
  );
  if (!checkoutResult.success) {
    throw new Error(checkoutResult.stderr || `Failed to check out pinned commit ${commitSha}.`);
  }
};

export { hasCommitObject };
