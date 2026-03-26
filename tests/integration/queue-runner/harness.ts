import { spawn, execFile as execFileCallback, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { join, resolve } from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import type {
  AcceptInviteRequest,
  CreateProjectRequest,
  CreateWebhookRequest,
  DispatchMode,
  GetProjectRunsResponse,
  GetProjectWebhooksResponse,
  LoginRequest,
  LoginResponse,
  ProjectDetail,
  ProjectResponse,
  RunDetail,
  RunStatus,
  TriggerRunRequest,
  TriggerRunAcceptedResponse,
  UpsertWebhookResponse,
} from "@/contracts";
import { BranchName, CommitSha, OwnerSlug, ProjectSlug } from "@/contracts";

const execFile = promisify(execFileCallback);

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const FIXTURE_REPO_URL = "https://github.com/miragespace/ci-test";
export const FIXTURE_DEFAULT_BRANCH = BranchName.assertDecode("main");
export const FIXTURE_CONFIG_PATH = ".anvil.yml";
export const GITHUB_WEBHOOK_PROVIDER = "github";
const WEBHOOK_BEFORE_SHA = CommitSha.assertDecode("1111111111111111111111111111111111111111");
export const EXPECTED_STEP_NAMES = ["install", "test", "build"] as const;
export const EXPECTED_LOG_MARKERS = ["CI Runner Probe", "Registry probe succeeded"] as const;
const SERVER_READY_TIMEOUT_MS = 120_000;
const RUN_TIMEOUT_MS = 240_000;
const PROJECT_SETTLE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1_000;
const NPX_COMMAND = process.platform === "win32" ? "npx.cmd" : "npx";
const VITE_BIN_PATH = resolve(REPO_ROOT, "node_modules/vite/bin/vite.js");

export interface BootstrapInviteSeedResult {
  mode: "local" | "remote";
  database: string;
  inviteId: string;
  token: string;
  expiresAt: string;
  sentinelCreator: string;
  dryRun: boolean;
}

export type OperatorCredentials = Omit<AcceptInviteRequest, "token">;
export type SessionId = LoginResponse["sessionId"];
export type ProjectRecord = ProjectResponse["project"];
export type ProjectId = ProjectRecord["id"];
export type IndexedRun = GetProjectRunsResponse["runs"][number];
export type RunId = TriggerRunAcceptedResponse["runId"];
export type WebhookSummary = GetProjectWebhooksResponse["webhooks"][number];
export type WebhookDelivery = WebhookSummary["recentDeliveries"][number];

interface CreateProjectOptions {
  dispatchMode?: DispatchMode;
}

export interface IntegrationContext {
  tempDir: string;
  baseUrl: string;
  port: number;
  serverProcess: ChildProcess;
  stdoutLogPath: string;
  stderrLogPath: string;
  stdoutStream: WriteStream;
  stderrStream: WriteStream;
}

class AssertionError extends Error {}

export const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) {
    throw new AssertionError(message);
  }
};

const delayUntil = async <T>(description: string, timeoutMs: number, action: () => Promise<T | null>): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const result = await action();
      if (result !== null) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  if (lastError instanceof Error) {
    throw new Error(`${description} timed out: ${lastError.message}`);
  }

  throw new Error(`${description} timed out.`);
};

const slugFragment = (): string => crypto.randomUUID().replace(/-/gu, "").slice(0, 10);

const closeWriteStream = async (stream: WriteStream): Promise<void> =>
  await new Promise<void>((resolveClose, reject) => {
    if (stream.destroyed || stream.closed || stream.writableFinished) {
      resolveClose();
      return;
    }

    try {
      stream.end((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }

        resolveClose();
      });
    } catch (error) {
      reject(error);
    }
  });

const getFreePort = async (): Promise<number> =>
  await new Promise<number>((resolvePort, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate a localhost port.")));
        return;
      }

      server.close((error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }

        resolvePort(address.port);
      });
    });
  });

const apiFetch = async <T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(new URL(path, baseUrl), init);
  const text = await response.text();
  const body: unknown = text.length > 0 ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${path}: ${text}`);
  }

  return body as T;
};

const apiFetchStatus = async (baseUrl: string, path: string): Promise<number> => {
  const response = await fetch(new URL(path, baseUrl), {
    signal: AbortSignal.timeout(5_000),
  });
  await response.arrayBuffer();
  return response.status;
};

const execCommand = async (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> =>
  await execFile(command, args, {
    cwd: REPO_ROOT,
    env,
    maxBuffer: 10 * 1024 * 1024,
  });

const waitForServerReady = async (baseUrl: string): Promise<void> => {
  await delayUntil("dev server readiness", SERVER_READY_TIMEOUT_MS, async () => {
    const rootStatus = await apiFetchStatus(baseUrl, "/");
    const privateStatus = await apiFetchStatus(baseUrl, "/api/private/me");
    return rootStatus === 200 && privateStatus === 403 ? true : null;
  });
};

export const applyMigrations = async (persistTo: string): Promise<void> => {
  await execCommand(
    NPX_COMMAND,
    ["wrangler", "d1", "migrations", "apply", "anvil-db", "--local", "--persist-to", persistTo],
    {
      ...process.env,
      CI: "1",
      NO_D1_WARNING: "true",
    },
  );
};

export const seedBootstrapInvite = async (persistTo: string): Promise<BootstrapInviteSeedResult> => {
  const { stdout } = await execCommand(
    process.execPath,
    ["--import", "tsx", "scripts/seed-bootstrap-invite.ts", "--local", "--persist-to", persistTo, "--json"],
    {
      ...process.env,
      TSX_TSCONFIG_PATH: "tsconfig.scripts.json",
      CI: "1",
      NO_D1_WARNING: "true",
    },
  );

  return JSON.parse(stdout.trim()) as BootstrapInviteSeedResult;
};

export const startDevServer = async (persistTo: string): Promise<IntegrationContext> => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const stdoutLogPath = join(persistTo, "dev.stdout.log");
  const stderrLogPath = join(persistTo, "dev.stderr.log");
  const stdoutStream = createWriteStream(stdoutLogPath, { flags: "a" });
  const stderrStream = createWriteStream(stderrLogPath, { flags: "a" });
  const serverProcess = spawn(process.execPath, [VITE_BIN_PATH, "dev", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ANVIL_PERSIST_STATE_PATH: persistTo,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  serverProcess.stdout?.pipe(stdoutStream);
  serverProcess.stderr?.pipe(stderrStream);

  try {
    await Promise.race([
      waitForServerReady(baseUrl),
      new Promise<never>((_, reject) => {
        serverProcess.once("exit", (code, signal) => {
          reject(new Error(`dev server exited before readiness (code=${code}, signal=${signal})`));
        });
      }),
    ]);
  } catch (error) {
    await stopDevServer(serverProcess);
    await closeWriteStream(stdoutStream);
    await closeWriteStream(stderrStream);
    throw error;
  }

  return {
    tempDir: persistTo,
    baseUrl,
    port,
    serverProcess,
    stdoutLogPath,
    stderrLogPath,
    stdoutStream,
    stderrStream,
  };
};

export const stopDevServer = async (serverProcess: ChildProcess): Promise<void> => {
  if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
    return;
  }

  const killServer = (signal: NodeJS.Signals): void => {
    if (serverProcess.pid === undefined) {
      return;
    }

    if (process.platform === "win32") {
      serverProcess.kill(signal);
      return;
    }

    process.kill(-serverProcess.pid, signal);
  };

  killServer("SIGTERM");
  const exited = await Promise.race([
    new Promise<boolean>((resolveExit) => {
      serverProcess.once("exit", () => resolveExit(true));
    }),
    sleep(10_000).then(() => false),
  ]);

  if (!exited && serverProcess.exitCode === null && serverProcess.signalCode === null) {
    killServer("SIGKILL");
    await new Promise<void>((resolveExit) => {
      serverProcess.once("exit", () => resolveExit());
    });
  }
};

export const closeContextLogs = async (context: IntegrationContext): Promise<void> => {
  context.serverProcess.stdout?.unpipe(context.stdoutStream);
  context.serverProcess.stderr?.unpipe(context.stderrStream);
  await closeWriteStream(context.stdoutStream);
  await closeWriteStream(context.stderrStream);
};

const authHeaders = (sessionId: SessionId): HeadersInit => ({
  authorization: `Bearer ${sessionId}`,
  "content-type": "application/json; charset=utf-8",
});

export const createOperatorCredentials = (): OperatorCredentials => {
  const slug = OwnerSlug.assertDecode(`queue-${slugFragment()}`);
  return {
    email: `${slug}@example.com`,
    displayName: "Queue Runner Integration",
    slug,
    password: `P@ss-${slugFragment()}-${Date.now()}`,
  };
};

const toGitHubRepositoryFullName = (repositoryUrl: string): string => {
  const url = new URL(repositoryUrl);
  return url.pathname.replace(/^\/+/u, "");
};

const buildGitHubRepository = (repositoryUrl: string, defaultBranch: string) => ({
  full_name: toGitHubRepositoryFullName(repositoryUrl),
  html_url: repositoryUrl,
  clone_url: `${repositoryUrl}.git`,
  default_branch: defaultBranch,
});

const signGitHubPayload = (secret: string, body: string): string =>
  `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

export const acceptBootstrapInvite = async (
  baseUrl: string,
  token: string,
  credentials: OperatorCredentials,
): Promise<LoginResponse> => {
  const body = {
    token,
    email: credentials.email,
    displayName: credentials.displayName,
    slug: credentials.slug,
    password: credentials.password,
  } satisfies AcceptInviteRequest;

  return await apiFetch<LoginResponse>(baseUrl, "/api/public/auth/invite/accept", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
};

export const login = async (baseUrl: string, credentials: OperatorCredentials): Promise<LoginResponse> => {
  const body = {
    email: credentials.email,
    password: credentials.password,
  } satisfies LoginRequest;

  return await apiFetch<LoginResponse>(baseUrl, "/api/public/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
};

export const createProject = async (
  baseUrl: string,
  sessionId: SessionId,
  name: string,
  options: CreateProjectOptions = {},
): Promise<ProjectRecord> => {
  const body = {
    projectSlug: ProjectSlug.assertDecode(`queue-${slugFragment()}`),
    name,
    repoUrl: FIXTURE_REPO_URL,
    defaultBranch: FIXTURE_DEFAULT_BRANCH,
    configPath: FIXTURE_CONFIG_PATH,
    dispatchMode: options.dispatchMode,
  } satisfies CreateProjectRequest;

  const response = await apiFetch<ProjectResponse>(baseUrl, "/api/private/projects", {
    method: "POST",
    headers: authHeaders(sessionId),
    body: JSON.stringify(body),
  });

  return response.project;
};

export const resolveFixtureHeadCommitSha = async (): Promise<string> => {
  const { stdout } = await execCommand("git", ["ls-remote", FIXTURE_REPO_URL, `refs/heads/${FIXTURE_DEFAULT_BRANCH}`], {
    ...process.env,
  });
  const commitSha = stdout.trim().split(/\s+/u)[0];
  assert(typeof commitSha === "string" && commitSha.length > 0, "Expected git ls-remote to return a commit SHA.");
  return CommitSha.assertDecode(commitSha);
};

export const triggerRun = async (baseUrl: string, sessionId: SessionId, projectId: ProjectId): Promise<RunId> => {
  const body = {} satisfies TriggerRunRequest;
  const response = await apiFetch<TriggerRunAcceptedResponse>(baseUrl, `/api/private/projects/${projectId}/runs`, {
    method: "POST",
    headers: authHeaders(sessionId),
    body: JSON.stringify(body),
  });

  return response.runId;
};

export const putGitHubWebhook = async (
  baseUrl: string,
  sessionId: SessionId,
  projectId: ProjectId,
  secret: string,
): Promise<WebhookSummary> => {
  const body = {
    enabled: true,
    secret,
  } satisfies CreateWebhookRequest;
  const response = await apiFetch<UpsertWebhookResponse>(
    baseUrl,
    `/api/private/projects/${projectId}/webhooks/${GITHUB_WEBHOOK_PROVIDER}`,
    {
      method: "PUT",
      headers: authHeaders(sessionId),
      body: JSON.stringify(body),
    },
  );

  return response.webhook;
};

export const getProjectWebhooks = async (
  baseUrl: string,
  sessionId: SessionId,
  projectId: ProjectId,
): Promise<GetProjectWebhooksResponse> =>
  await apiFetch<GetProjectWebhooksResponse>(baseUrl, `/api/private/projects/${projectId}/webhooks`, {
    headers: {
      authorization: `Bearer ${sessionId}`,
    },
  });

export const postGitHubPushWebhook = async (
  baseUrl: string,
  project: Pick<ProjectRecord, "ownerSlug" | "projectSlug" | "repoUrl" | "defaultBranch">,
  secret: string,
  deliveryId: string,
  commitSha: string,
): Promise<{ status: number; text: string }> => {
  const body = JSON.stringify({
    ref: `refs/heads/${project.defaultBranch}`,
    before: WEBHOOK_BEFORE_SHA,
    after: commitSha,
    head_commit: {
      id: commitSha,
    },
    repository: buildGitHubRepository(project.repoUrl, project.defaultBranch),
  });
  const response = await fetch(
    new URL(`/api/public/hooks/${GITHUB_WEBHOOK_PROVIDER}/${project.ownerSlug}/${project.projectSlug}`, baseUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-github-event": "push",
        "x-github-delivery": deliveryId,
        "x-hub-signature-256": signGitHubPayload(secret, body),
      },
      body,
    },
  );

  return {
    status: response.status,
    text: await response.text(),
  };
};

export const getRunDetail = async (baseUrl: string, sessionId: SessionId, runId: RunId): Promise<RunDetail> =>
  await apiFetch<RunDetail>(baseUrl, `/api/private/runs/${runId}`, {
    headers: {
      authorization: `Bearer ${sessionId}`,
    },
  });

export const getProjectDetail = async (
  baseUrl: string,
  sessionId: SessionId,
  projectId: ProjectId,
): Promise<ProjectDetail> =>
  await apiFetch<ProjectDetail>(baseUrl, `/api/private/projects/${projectId}`, {
    headers: {
      authorization: `Bearer ${sessionId}`,
    },
  });

export const getProjectRuns = async (
  baseUrl: string,
  sessionId: SessionId,
  projectId: ProjectId,
): Promise<GetProjectRunsResponse> =>
  await apiFetch<GetProjectRunsResponse>(baseUrl, `/api/private/projects/${projectId}/runs`, {
    headers: {
      authorization: `Bearer ${sessionId}`,
    },
  });

export const waitForTerminalRun = async (baseUrl: string, sessionId: SessionId, runId: RunId): Promise<RunDetail> =>
  await delayUntil(`run ${runId} terminalization`, RUN_TIMEOUT_MS, async () => {
    const detail = await getRunDetail(baseUrl, sessionId, runId);
    return detail.run.status === "passed" || detail.run.status === "failed" || detail.run.status === "canceled"
      ? detail
      : null;
  });

export const waitForProjectSettled = async (
  baseUrl: string,
  sessionId: SessionId,
  projectId: ProjectId,
): Promise<ProjectDetail> =>
  await delayUntil(`project ${projectId} reconciliation`, PROJECT_SETTLE_TIMEOUT_MS, async () => {
    const detail = await getProjectDetail(baseUrl, sessionId, projectId);
    return detail.activeRun === null && detail.pendingRuns.length === 0 ? detail : null;
  });

export const waitForIndexedRun = async (
  baseUrl: string,
  sessionId: SessionId,
  projectId: ProjectId,
  runId: RunId,
  expectedStatus: RunStatus,
): Promise<IndexedRun> =>
  await delayUntil(`run ${runId} D1 sync`, PROJECT_SETTLE_TIMEOUT_MS, async () => {
    const response = await getProjectRuns(baseUrl, sessionId, projectId);
    const found = response.runs.find((run) => run.id === runId);
    return found && found.status === expectedStatus ? found : null;
  });

export const waitForAcceptedWebhookDelivery = async (
  baseUrl: string,
  sessionId: SessionId,
  projectId: ProjectId,
  deliveryId: string,
): Promise<WebhookDelivery> =>
  await delayUntil(`webhook delivery ${deliveryId} acceptance`, PROJECT_SETTLE_TIMEOUT_MS, async () => {
    const response = await getProjectWebhooks(baseUrl, sessionId, projectId);
    const webhook = response.webhooks.find((candidate) => candidate.provider === GITHUB_WEBHOOK_PROVIDER);
    const delivery = webhook?.recentDeliveries.find((candidate) => candidate.deliveryId === deliveryId);
    return delivery && delivery.outcome === "accepted" && delivery.runId !== null ? delivery : null;
  });

export const printFailureContext = (context: IntegrationContext): void => {
  console.error(`Preserved temp state: ${context.tempDir}`);
  console.error(`Dev server stdout: ${context.stdoutLogPath}`);
  console.error(`Dev server stderr: ${context.stderrLogPath}`);
  console.error(
    `Reopen preserved state: ANVIL_PERSIST_STATE_PATH=${context.tempDir} npm run dev -- --host 127.0.0.1 --port ${context.port}`,
  );
};

export const printLogTails = async (context: IntegrationContext): Promise<void> => {
  for (const [label, filePath] of [
    ["stdout", context.stdoutLogPath],
    ["stderr", context.stderrLogPath],
  ] as const) {
    try {
      const content = await readFile(filePath, "utf8");
      const tail = content.trim().split("\n").slice(-20).join("\n");
      if (tail.length > 0) {
        console.error(`Last ${label} log lines:\n${tail}`);
      }
    } catch {}
  }
};
