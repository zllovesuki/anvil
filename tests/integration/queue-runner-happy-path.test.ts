import { afterAll, beforeAll, describe, it } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  type BootstrapInviteSeedResult,
  type IntegrationContext,
  type OperatorCredentials,
  type SessionId,
  acceptBootstrapInvite,
  applyMigrations,
  assert,
  closeContextLogs,
  createOperatorCredentials,
  login,
  printFailureContext,
  printLogTails,
  seedBootstrapInvite,
  startDevServer,
  stopDevServer,
} from "./queue-runner/harness";
import {
  scenarioBackToBackRunsAreSerial,
  scenarioSingleRunPasses,
  scenarioWebhookTriggeredRunPasses,
} from "./queue-runner/scenarios";

describe("queue runner integration", () => {
  let context: IntegrationContext | null = null;
  let invite: BootstrapInviteSeedResult | null = null;
  let operatorCredentials: OperatorCredentials | null = null;
  let tempDir: string | null = null;
  let preserveTempState = false;

  const requireContext = (): IntegrationContext => {
    assert(context !== null, "Integration context not initialized.");
    return context;
  };

  const ensureOperatorSession = async (): Promise<SessionId> => {
    const currentContext = requireContext();
    assert(invite !== null, "Bootstrap invite not initialized.");

    if (operatorCredentials === null) {
      operatorCredentials = createOperatorCredentials();
      const accepted = await acceptBootstrapInvite(currentContext.baseUrl, invite.token, operatorCredentials);
      assert(
        accepted.user.slug === operatorCredentials.slug,
        `Expected accepted user slug ${operatorCredentials.slug}.`,
      );
      assert(
        accepted.user.email === operatorCredentials.email,
        `Expected accepted user email ${operatorCredentials.email}.`,
      );
      assert(
        accepted.user.displayName === operatorCredentials.displayName,
        `Expected accepted displayName ${operatorCredentials.displayName}.`,
      );
      assert(accepted.expiresAt.length > 0, "Expected invite acceptance to return expiresAt.");
    }

    const loggedIn = await login(currentContext.baseUrl, operatorCredentials);
    assert(
      loggedIn.user.slug === operatorCredentials.slug,
      `Expected logged in user slug ${operatorCredentials.slug}.`,
    );
    assert(
      loggedIn.user.email === operatorCredentials.email,
      `Expected logged in user email ${operatorCredentials.email}.`,
    );
    assert(loggedIn.expiresAt.length > 0, "Expected login to return expiresAt.");
    return loggedIn.sessionId;
  };

  const runScenario = async (scenario: (baseUrl: string, sessionId: SessionId) => Promise<void>): Promise<void> => {
    const currentContext = requireContext();

    try {
      const sessionId = await ensureOperatorSession();
      await scenario(currentContext.baseUrl, sessionId);
    } catch (error) {
      preserveTempState = true;
      throw error;
    }
  };

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "anvil-queue-int-"));
    console.log(`Using temp state: ${tempDir}`);

    try {
      await applyMigrations(tempDir);
      invite = await seedBootstrapInvite(tempDir);
      context = await startDevServer(tempDir);
    } catch (error) {
      preserveTempState = true;
      throw error;
    }
  });

  afterAll(async () => {
    if (context) {
      await stopDevServer(context.serverProcess);
      await closeContextLogs(context);
    }

    if (!tempDir) {
      return;
    }

    if (!preserveTempState) {
      await rm(tempDir, { recursive: true, force: true });
      return;
    }

    if (context) {
      printFailureContext(context);
      await printLogTails(context);
      return;
    }

    console.error(`Preserved temp state: ${tempDir}`);
  });

  it("accepts the bootstrap invite, logs in, and passes a single queued run", async () => {
    await runScenario(scenarioSingleRunPasses);
  });

  it("logs in and serializes back-to-back runs", async () => {
    await runScenario(scenarioBackToBackRunsAreSerial);
  });

  it("accepts a verified GitHub webhook and passes the queued run", async () => {
    await runScenario(scenarioWebhookTriggeredRunPasses);
  });
});
