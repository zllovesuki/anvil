import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyMigrations,
  seedBootstrapInvite,
  startDevServer,
  stopDevServer,
  closeContextLogs,
  printFailureContext,
  printLogTails,
  type IntegrationContext,
} from "../integration/queue-runner/harness";

export const E2E_CONTEXT_PATH_ENV = "ANVIL_E2E_CONTEXT_PATH";

export interface E2eContext {
  baseUrl: string;
  inviteToken: string;
  tempDir: string;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const tempDir = await mkdtemp(join(tmpdir(), "anvil-e2e-"));
  console.log(`[e2e] temp state: ${tempDir}`);

  await applyMigrations(tempDir);
  const invite = await seedBootstrapInvite(tempDir);
  const ctx = await startDevServer(tempDir);

  const e2eContext: E2eContext = {
    baseUrl: ctx.baseUrl,
    inviteToken: invite.token,
    tempDir,
  };

  const contextPath = join(tempDir, ".e2e-context.json");
  await writeFile(contextPath, JSON.stringify(e2eContext));

  process.env.ANVIL_E2E_BASE_URL = ctx.baseUrl;
  process.env[E2E_CONTEXT_PATH_ENV] = contextPath;

  return async () => {
    await teardown(ctx, tempDir);
  };
}

async function teardown(ctx: IntegrationContext, tempDir: string): Promise<void> {
  await stopDevServer(ctx.serverProcess);
  await closeContextLogs(ctx);

  if (process.env.ANVIL_E2E_PRESERVE === "1") {
    printFailureContext(ctx);
    await printLogTails(ctx);
    console.log(`[e2e] temp state preserved: ${tempDir}`);
  } else {
    await rm(tempDir, { recursive: true, force: true });
    console.log(`[e2e] temp state cleaned up`);
  }
}
