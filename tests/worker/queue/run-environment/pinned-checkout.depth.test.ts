import { describe, expect, it } from "vitest";

import { CommitSha, type CommitSha as CommitShaType } from "@/contracts";
import { prepareExecutionEnvironment } from "@/worker/queue/run-environment";

import {
  INVALID_REPO_CONFIG,
  VALID_REPO_CONFIG,
  createExecResult,
  createHarness,
  createLeaseStub,
} from "../../../helpers/run-environment";

const expectPinnedCheckoutFailure = async (
  commitSha: CommitShaType,
  options: {
    projectIdValue: string;
    runIdValue: string;
    configContent?: string;
    execImpl: (command: string, events: string[]) => ReturnType<typeof createExecResult>;
  },
) => {
  const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = createHarness({
    projectIdValue: options.projectIdValue,
    runIdValue: options.runIdValue,
    snapshotCommitSha: commitSha,
    configContent: options.configContent ?? INVALID_REPO_CONFIG,
    execImpl: (command) => options.execImpl(command, events),
  });

  return {
    context,
    events,
    projectId,
    recordRunResolvedCommit,
    runId,
    sandbox,
  };
};

describe("run environment preparation", () => {
  describe("pinned checkout depth handling", () => {
    it("deepens pinned checkouts by exact SHA after loading repo config", async () => {
      const pinnedCommitSha = CommitSha.assertDecode("4444444444444444444444444444444444444444");
      let catFileChecks = 0;
      let checkedOutPinnedCommit = false;

      const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = await expectPinnedCheckoutFailure(
        pinnedCommitSha,
        {
          projectIdValue: "prj_2222222222222222222222",
          runIdValue: "run_2222222222222222222222",
          configContent: VALID_REPO_CONFIG,
          execImpl: (command, events) => {
            if (command.includes(" clone --branch ") || command.includes(" origin 'main'")) {
              throw new Error(`Pinned checkout should not depend on branch refs: ${command}`);
            }

            if (command.startsWith("git init ")) {
              events.push("init");
              return createExecResult();
            }

            if (command.includes("remote add origin")) {
              events.push("remote-add");
              return createExecResult();
            }

            if (command.includes(`fetch --depth=1 --update-shallow origin '${pinnedCommitSha}'`)) {
              events.push("fetch-depth-1");
              return createExecResult();
            }

            if (command.includes("cat-file -e")) {
              catFileChecks += 1;
              events.push(`cat-file-${catFileChecks}`);
              return createExecResult({
                success: catFileChecks >= 2,
                stderr: catFileChecks >= 2 ? "" : "fatal: Not a valid object name",
              });
            }

            if (command.includes(`fetch --depth=3 --update-shallow origin '${pinnedCommitSha}'`)) {
              events.push("fetch-depth-3");
              return createExecResult();
            }

            if (command.includes("rev-parse --is-shallow-repository")) {
              events.push("check-shallow");
              return createExecResult({
                stdout: "true\n",
              });
            }

            if (command.includes("checkout --detach")) {
              expect(command).toContain(pinnedCommitSha);
              checkedOutPinnedCommit = true;
              events.push("checkout-detached");
              return createExecResult();
            }

            if (command.includes("rev-parse HEAD")) {
              events.push("rev-parse");
              return createExecResult({
                stdout: `${checkedOutPinnedCommit ? pinnedCommitSha : pinnedCommitSha}\n`,
              });
            }

            throw new Error(`Unexpected exec command: ${command}`);
          },
        },
      );

      await expect(prepareExecutionEnvironment(context, createLeaseStub())).resolves.toEqual({
        repoConfig: expect.objectContaining({
          checkout: expect.objectContaining({ depth: 3 }),
        }),
        workingDirectory: "/workspace/repo",
      });

      expect(recordRunResolvedCommit).toHaveBeenCalledWith({
        projectId,
        runId,
        commitSha: pinnedCommitSha,
      });
      expect(catFileChecks).toBe(2);
      expect(events).toContain("fetch-depth-1");
      expect(events).toContain("fetch-depth-3");
      expect(events.indexOf("record-run-resolved-commit")).toBeLessThan(events.indexOf("read-file"));
      expect(events.indexOf("fetch-depth-3")).toBeGreaterThan(events.indexOf("read-file"));
      expect(events.indexOf("checkout-detached")).toBeGreaterThan(events.indexOf("cat-file-2"));
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toMatchObject({ id: "run-session" });
    });

    it("skips pinned depth expansion after a full-history fallback", async () => {
      const rewrittenHeadSha = CommitSha.assertDecode("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
      const pinnedCommitSha = CommitSha.assertDecode("cccccccccccccccccccccccccccccccccccccccc");
      let catFileChecks = 0;
      let checkedOutPinnedCommit = false;

      const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = await expectPinnedCheckoutFailure(
        pinnedCommitSha,
        {
          projectIdValue: "prj_7777777777777777777777",
          runIdValue: "run_7777777777777777777777",
          configContent: VALID_REPO_CONFIG,
          execImpl: (command, events) => {
            if (command.includes(" clone --branch ") || command.includes(" origin 'main'")) {
              throw new Error(`Pinned checkout should not depend on branch refs: ${command}`);
            }

            if (command.startsWith("git init ")) {
              events.push("init");
              return createExecResult();
            }

            if (command.includes("remote add origin")) {
              events.push("remote-add");
              return createExecResult();
            }

            if (command.includes("cat-file -e")) {
              catFileChecks += 1;
              events.push(`cat-file-${catFileChecks}`);
              return createExecResult({
                success: events.includes("fetch-exact-sha"),
                stderr: events.includes("fetch-exact-sha") ? "" : "fatal: Not a valid object name",
              });
            }

            if (command.includes(`fetch --depth=1 --update-shallow origin '${pinnedCommitSha}'`)) {
              events.push("fetch-depth-1");
              return createExecResult({
                success: false,
                stderr: "fatal: dumb http transport does not support shallow capabilities",
              });
            }

            if (command.includes(`fetch --depth=3 --update-shallow origin '${pinnedCommitSha}'`)) {
              throw new Error(`Pinned depth expansion should be skipped after full fallback: ${command}`);
            }

            if (command.includes(`fetch origin '${pinnedCommitSha}'`)) {
              events.push("fetch-exact-sha");
              return createExecResult();
            }

            if (command.includes("rev-parse --is-shallow-repository")) {
              events.push("check-shallow");
              return createExecResult({
                stdout: "false\n",
              });
            }

            if (command.includes("checkout --detach")) {
              expect(command).toContain(pinnedCommitSha);
              checkedOutPinnedCommit = true;
              events.push("checkout-detached");
              return createExecResult();
            }

            if (command.includes("rev-parse HEAD")) {
              events.push("rev-parse");
              return createExecResult({
                stdout: `${checkedOutPinnedCommit ? pinnedCommitSha : rewrittenHeadSha}\n`,
              });
            }

            throw new Error(`Unexpected exec command: ${command}`);
          },
        },
      );

      await expect(prepareExecutionEnvironment(context, createLeaseStub())).resolves.toEqual({
        repoConfig: expect.objectContaining({
          checkout: expect.objectContaining({ depth: 3 }),
        }),
        workingDirectory: "/workspace/repo",
      });

      expect(recordRunResolvedCommit).toHaveBeenCalledWith({
        projectId,
        runId,
        commitSha: pinnedCommitSha,
      });
      expect(events.indexOf("fetch-exact-sha")).toBeGreaterThan(events.indexOf("fetch-depth-1"));
      expect(events.indexOf("cat-file-2")).toBeGreaterThan(events.indexOf("fetch-exact-sha"));
      expect(events.indexOf("record-run-resolved-commit")).toBeLessThan(events.indexOf("read-file"));
      expect(events.indexOf("check-shallow")).toBeGreaterThan(events.indexOf("read-file"));
      expect(events).not.toContain("fetch-depth-3");
      expect(events.indexOf("checkout-detached")).toBeGreaterThan(events.indexOf("cat-file-2"));
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toMatchObject({ id: "run-session" });
    });
  });
});
