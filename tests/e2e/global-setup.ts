import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyMigrations,
  startDevServer,
  stopDevServer,
  closeContextLogs,
  printFailureContext,
  printLogTails,
  type IntegrationContext,
} from "../integration/queue-runner/harness";
import { startMockOidcProvider, type MockOidcServer } from "../helpers/oidc-mock";

export const E2E_CONTEXT_PATH_ENV = "ANVIL_E2E_CONTEXT_PATH";

export interface E2eContext {
  baseUrl: string;
  oidcIssuer: string;
  tempDir: string;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const tempDir = await mkdtemp(join(tmpdir(), "anvil-e2e-"));
  console.log(`[e2e] temp state: ${tempDir}`);

  let mockOidc: MockOidcServer | null = null;
  let ctx: IntegrationContext | null = null;

  try {
    mockOidc = await startMockOidcProvider();
    await applyMigrations(tempDir);
    ctx = await startDevServer(tempDir, mockOidc.issuer);
  } catch (error) {
    if (ctx) {
      await stopDevServer(ctx.serverProcess);
      await closeContextLogs(ctx);
    }
    if (mockOidc) {
      await mockOidc.close();
    }
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
  if (!ctx || !mockOidc) {
    throw new Error("E2E setup did not initialize the dev server and OIDC provider.");
  }

  const e2eContext: E2eContext = {
    baseUrl: ctx.baseUrl,
    oidcIssuer: mockOidc.issuer,
    tempDir,
  };

  const contextPath = join(tempDir, ".e2e-context.json");
  await writeFile(contextPath, JSON.stringify(e2eContext));

  process.env.ANVIL_E2E_BASE_URL = ctx.baseUrl;
  process.env[E2E_CONTEXT_PATH_ENV] = contextPath;

  return async () => {
    await teardown(ctx, tempDir, mockOidc);
  };
}

async function teardown(ctx: IntegrationContext, tempDir: string, mockOidc: MockOidcServer): Promise<void> {
  await stopDevServer(ctx.serverProcess);
  await closeContextLogs(ctx);
  await mockOidc.close();

  if (process.env.ANVIL_E2E_PRESERVE === "1") {
    printFailureContext(ctx);
    await printLogTails(ctx);
    console.log(`[e2e] temp state preserved: ${tempDir}`);
  } else {
    await rm(ctx.devVarsPath, { force: true });
    await rm(tempDir, { recursive: true, force: true });
    console.log(`[e2e] temp state cleaned up`);
  }
}
