import { describe, expect, it } from "vitest";

import { CommitSha } from "@/contracts";
import { prepareExecutionEnvironment } from "@/worker/queue/run-environment";
import { RunOwnershipLostError } from "@/worker/queue/run-lease";

import { createExecResult, createHarness, createLeaseStub } from "../../../helpers/run-environment";

const expectBranchCheckoutInitialized = (events: string[]): void => {
  expect(events).toContain("init");
  expect(events.indexOf("remote-add")).toBeGreaterThan(events.indexOf("init"));
  expect(events.indexOf("fetch-depth-1")).toBeGreaterThan(events.indexOf("remote-add"));
};

describe("run environment preparation", () => {
  describe("resolved commit recording", () => {
    it("records the resolved commit before config loading failures", async () => {
      const commitSha = CommitSha.assertDecode("0123456789abcdef0123456789abcdef01234567");
      const { context, events, projectId, recordRunResolvedCommit, replaceSteps, runId, sandbox } = createHarness({
        projectIdValue: "prj_0000000000000000000000",
        runIdValue: "run_0000000000000000000000",
        snapshotCommitSha: null,
        execImpl: (command) => {
          if (command.startsWith("git init ")) {
            events.push("init");
            return createExecResult();
          }

          if (command.includes("remote add origin")) {
            events.push("remote-add");
            return createExecResult();
          }

          if (command.includes("fetch --depth=1 --update-shallow origin 'main'")) {
            events.push("fetch-depth-1");
            return createExecResult();
          }

          if (command.includes("checkout -B 'main' FETCH_HEAD")) {
            events.push("checkout-branch");
            return createExecResult();
          }

          if (command.includes("branch --set-upstream-to='origin/main' 'main'")) {
            events.push("set-upstream");
            return createExecResult();
          }

          if (command.includes("rev-parse HEAD")) {
            events.push("rev-parse");
            return createExecResult({
              stdout: `${commitSha}\n`,
            });
          }

          throw new Error(`Unexpected exec command: ${command}`);
        },
      });

      await expect(prepareExecutionEnvironment(context, createLeaseStub())).rejects.toThrow(
        "Repository config is not valid YAML",
      );

      expect(recordRunResolvedCommit).toHaveBeenCalledWith({
        projectId,
        runId,
        commitSha,
      });
      expect(replaceSteps).not.toHaveBeenCalled();
      expectBranchCheckoutInitialized(events);
      expect(events.indexOf("record-run-resolved-commit")).toBeGreaterThanOrEqual(0);
      expect(events.indexOf("read-file")).toBeGreaterThanOrEqual(0);
      expect(events.indexOf("record-run-resolved-commit")).toBeLessThan(events.indexOf("read-file"));
      expect(events.indexOf("checkout-branch")).toBeGreaterThan(events.indexOf("fetch-depth-1"));
      expect(events.indexOf("set-upstream")).toBeGreaterThan(events.indexOf("checkout-branch"));
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toBeNull();
    });

    it("stops checkout when resolved-commit backfill reports stale ownership", async () => {
      const commitSha = CommitSha.assertDecode("1111111111111111111111111111111111111111");
      const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = createHarness({
        projectIdValue: "prj_9999999999999999999990",
        runIdValue: "run_9999999999999999999990",
        snapshotCommitSha: null,
        recordRunResolvedCommitResult: {
          kind: "stale",
          status: "failed",
        },
        execImpl: (command) => {
          if (command.startsWith("git init ")) {
            events.push("init");
            return createExecResult();
          }

          if (command.includes("remote add origin")) {
            events.push("remote-add");
            return createExecResult();
          }

          if (command.includes("fetch --depth=1 --update-shallow origin 'main'")) {
            events.push("fetch-depth-1");
            return createExecResult();
          }

          if (command.includes("checkout -B 'main' FETCH_HEAD")) {
            events.push("checkout-branch");
            return createExecResult();
          }

          if (command.includes("branch --set-upstream-to='origin/main' 'main'")) {
            events.push("set-upstream");
            return createExecResult();
          }

          if (command.includes("rev-parse HEAD")) {
            events.push("rev-parse");
            return createExecResult({
              stdout: `${commitSha}\n`,
            });
          }

          throw new Error(`Unexpected exec command: ${command}`);
        },
      });

      const error = await prepareExecutionEnvironment(
        context,
        createLeaseStub({
          throwIfOwnershipLost: () => {
            if (context.state.ownershipLost) {
              throw new RunOwnershipLostError(context.state.ownershipLossStatus);
            }
          },
        }),
      ).catch((error) => error);

      expect(error).toBeInstanceOf(RunOwnershipLostError);
      expect((error as RunOwnershipLostError).observedStatus).toBe("failed");
      expect(recordRunResolvedCommit).toHaveBeenCalledWith({
        projectId,
        runId,
        commitSha,
      });
      expectBranchCheckoutInitialized(events);
      expect(events).toContain("record-run-resolved-commit");
      expect(events).toContain("ownership-lost");
      expect(events.indexOf("ownership-lost")).toBeGreaterThan(events.indexOf("record-run-resolved-commit"));
      expect(events).not.toContain("read-file");
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toBeNull();
    });
  });
});
