import { afterAll, beforeAll, describe, it } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  type IntegrationContext,
  type OperatorIdentity,
  type SessionId,
  applyMigrations,
  assert,
  closeContextLogs,
  createOperatorIdentity,
  oidcSignInOnce,
  printFailureContext,
  printLogTails,
  startDevServer,
  stopDevServer,
} from "./queue-runner/harness";
import { scenarioWorkflowRunPasses } from "./queue-runner/scenarios";
import { startMockOidcProvider, type MockOidcServer } from "../helpers/oidc-mock";

describe("workflows runner integration", () => {
  let context: IntegrationContext | null = null;
  let mockOidc: MockOidcServer | null = null;
  let operatorIdentity: OperatorIdentity | null = null;
  let tempDir: string | null = null;
  let preserveTempState = false;

  const requireContext = (): IntegrationContext => {
    assert(context !== null, "Integration context not initialized.");
    return context;
  };

  const ensureOperatorSession = async (): Promise<SessionId> => {
    const currentContext = requireContext();

    if (operatorIdentity === null) {
      operatorIdentity = createOperatorIdentity();
    }

    return await oidcSignInOnce(currentContext, operatorIdentity);
  };

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "anvil-workflows-int-"));
    console.log(`Using temp state: ${tempDir}`);

    try {
      mockOidc = await startMockOidcProvider();
      await applyMigrations(tempDir);
      context = await startDevServer(tempDir, mockOidc.issuer);
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

    if (mockOidc) {
      await mockOidc.close();
    }

    if (!tempDir) {
      return;
    }

    if (!preserveTempState) {
      if (context) {
        await rm(context.devVarsPath, { force: true });
      }
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

  it("signs in with tessera and passes a single workflow-backed run", async () => {
    const currentContext = requireContext();

    try {
      const sessionId = await ensureOperatorSession();
      await scenarioWorkflowRunPasses(currentContext.baseUrl, sessionId);
    } catch (error) {
      preserveTempState = true;
      throw error;
    }
  });
});
