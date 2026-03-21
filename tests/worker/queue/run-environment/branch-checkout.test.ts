import { describe, expect, it } from "vitest";

import { CommitSha } from "@/contracts";
import { prepareExecutionEnvironment } from "@/worker/queue/run-environment";

import { VALID_REPO_CONFIG, createExecResult, createHarness, createLeaseStub } from "../../../helpers/run-environment";

const expectBranchCheckoutInitialized = (events: string[]): void => {
  expect(events).toContain("init");
  expect(events.indexOf("remote-add")).toBeGreaterThan(events.indexOf("init"));
  expect(events.indexOf("fetch-depth-1")).toBeGreaterThan(events.indexOf("remote-add"));
};

describe("run environment preparation", () => {
  describe("branch checkout fallback", () => {
    it("falls back to a full branch fetch when the server rejects shallow requests", async () => {
      const commitSha = CommitSha.assertDecode("2222222222222222222222222222222222222222");
      const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = createHarness({
        projectIdValue: "prj_2222222222222222222222",
        runIdValue: "run_2222222222222222222222",
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
            return createExecResult({
              success: false,
              stderr: "fatal: Server does not support shallow requests",
            });
          }

          if (command.includes("fetch origin 'main'")) {
            events.push("fetch-full");
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
      expectBranchCheckoutInitialized(events);
      expect(events.indexOf("fetch-full")).toBeGreaterThan(events.indexOf("fetch-depth-1"));
      expect(events.indexOf("checkout-branch")).toBeGreaterThan(events.indexOf("fetch-full"));
      expect(events.indexOf("set-upstream")).toBeGreaterThan(events.indexOf("checkout-branch"));
      expect(events.indexOf("record-run-resolved-commit")).toBeGreaterThan(events.indexOf("checkout-branch"));
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toBeNull();
    });

    it("skips branch depth expansion after a full-history fallback", async () => {
      const commitSha = CommitSha.assertDecode("3333333333333333333333333333333333333333");
      const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = createHarness({
        projectIdValue: "prj_3333333333333333333333",
        runIdValue: "run_3333333333333333333333",
        snapshotCommitSha: null,
        configContent: VALID_REPO_CONFIG,
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
            return createExecResult({
              success: false,
              stderr: "fatal: dumb http transport does not support shallow capabilities",
            });
          }

          if (command.includes("fetch --depth=3 --update-shallow origin 'main'")) {
            throw new Error(`Branch depth expansion should be skipped after full fallback: ${command}`);
          }

          if (command.includes("fetch origin 'main'")) {
            events.push("fetch-full");
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

          if (command.includes("rev-parse --is-shallow-repository")) {
            events.push("check-shallow");
            return createExecResult({
              stdout: "false\n",
            });
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

      await expect(prepareExecutionEnvironment(context, createLeaseStub())).resolves.toEqual({
        repoConfig: expect.objectContaining({
          checkout: expect.objectContaining({ depth: 3 }),
        }),
        workingDirectory: "/workspace/repo",
      });

      expect(recordRunResolvedCommit).toHaveBeenCalledWith({
        projectId,
        runId,
        commitSha,
      });
      expectBranchCheckoutInitialized(events);
      expect(events.indexOf("fetch-full")).toBeGreaterThan(events.indexOf("fetch-depth-1"));
      expect(events.indexOf("record-run-resolved-commit")).toBeLessThan(events.indexOf("read-file"));
      expect(events.indexOf("set-upstream")).toBeGreaterThan(events.indexOf("checkout-branch"));
      expect(events.indexOf("check-shallow")).toBeGreaterThan(events.indexOf("read-file"));
      expect(events).not.toContain("fetch-depth-3");
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toMatchObject({ id: "run-session" });
    });
  });
});
