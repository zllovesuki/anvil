import { describe, expect, it } from "vitest";

import { CommitSha, type CommitSha as CommitShaType } from "@/contracts";
import { prepareExecutionEnvironment } from "@/worker/dispatch/shared/run-environment";

import {
  INVALID_REPO_CONFIG,
  createExecResult,
  createHarness,
  createLeaseStub,
} from "../../../../helpers/run-environment";

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
  describe("pinned checkout fetch strategy", () => {
    it("checks out a pinned commit without cloning against the branch ref", async () => {
      const pinnedCommitSha = CommitSha.assertDecode("2222222222222222222222222222222222222222");
      let catFileChecks = 0;
      let checkedOutPinnedCommit = false;

      const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = await expectPinnedCheckoutFailure(
        pinnedCommitSha,
        {
          projectIdValue: "prj_1111111111111111111111",
          runIdValue: "run_1111111111111111111111",
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
                success: catFileChecks >= 2,
                stderr: catFileChecks >= 2 ? "" : "fatal: Not a valid object name",
              });
            }

            if (command.includes(`fetch --depth=1 --update-shallow origin '${pinnedCommitSha}'`)) {
              events.push("fetch-depth-1");
              return createExecResult();
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

      await expect(prepareExecutionEnvironment(context, createLeaseStub())).rejects.toThrow(
        "Repository config is not valid YAML",
      );

      expect(recordRunResolvedCommit).toHaveBeenCalledWith({
        projectId,
        runId,
        commitSha: pinnedCommitSha,
      });
      expect(events).toContain("init");
      expect(events).toContain("remote-add");
      expect(events).toContain("fetch-depth-1");
      expect(events.indexOf("cat-file-1")).toBeGreaterThan(events.indexOf("remote-add"));
      expect(events.indexOf("fetch-depth-1")).toBeGreaterThan(events.indexOf("cat-file-1"));
      expect(events.indexOf("cat-file-2")).toBeGreaterThan(events.indexOf("fetch-depth-1"));
      expect(events.indexOf("checkout-detached")).toBeGreaterThan(events.indexOf("cat-file-2"));
      expect(events.indexOf("record-run-resolved-commit")).toBeGreaterThan(events.indexOf("checkout-detached"));
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toBeNull();
    });

    it("deepens the pinned checkout before falling back to broader fetches", async () => {
      const rewrittenHeadSha = CommitSha.assertDecode("5555555555555555555555555555555555555555");
      const pinnedCommitSha = CommitSha.assertDecode("6666666666666666666666666666666666666666");
      const depthFetches: number[] = [];
      let catFileChecks = 0;
      let checkedOutPinnedCommit = false;

      const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = await expectPinnedCheckoutFailure(
        pinnedCommitSha,
        {
          projectIdValue: "prj_3333333333333333333333",
          runIdValue: "run_3333333333333333333333",
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

            const depthMatch = command.match(/fetch --depth=(\d+)/u);
            if (depthMatch) {
              const depth = Number(depthMatch[1]);
              depthFetches.push(depth);
              events.push(`fetch-depth-${depth}`);
              return createExecResult();
            }

            if (command.includes(`fetch origin '${pinnedCommitSha}'`)) {
              events.push("fetch-exact-sha");
              return createExecResult();
            }

            if (command.includes("cat-file -e")) {
              catFileChecks += 1;
              events.push(`cat-file-${catFileChecks}`);
              return createExecResult({
                success: depthFetches.includes(2),
                stderr: depthFetches.includes(2) ? "" : "fatal: Not a valid object name",
              });
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
                stdout: `${checkedOutPinnedCommit ? pinnedCommitSha : rewrittenHeadSha}\n`,
              });
            }

            throw new Error(`Unexpected exec command: ${command}`);
          },
        },
      );

      await expect(prepareExecutionEnvironment(context, createLeaseStub())).rejects.toThrow(
        "Repository config is not valid YAML",
      );

      expect(recordRunResolvedCommit).toHaveBeenCalledWith({
        projectId,
        runId,
        commitSha: pinnedCommitSha,
      });
      expect(depthFetches).toEqual([1, 2]);
      expect(catFileChecks).toBe(3);
      expect(events).not.toContain("fetch-exact-sha");
      expect(events).not.toContain("fetch-unshallow");
      expect(events.indexOf("fetch-depth-1")).toBeGreaterThan(events.indexOf("cat-file-1"));
      expect(events.indexOf("cat-file-2")).toBeGreaterThan(events.indexOf("fetch-depth-1"));
      expect(events.indexOf("fetch-depth-2")).toBeGreaterThan(events.indexOf("cat-file-2"));
      expect(events.indexOf("cat-file-3")).toBeGreaterThan(events.indexOf("fetch-depth-2"));
      expect(events.indexOf("checkout-detached")).toBeGreaterThan(events.indexOf("cat-file-3"));
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toBeNull();
    });

    it("fetches the pinned commit by SHA when depth probes do not find it", async () => {
      const rewrittenHeadSha = CommitSha.assertDecode("7777777777777777777777777777777777777777");
      const pinnedCommitSha = CommitSha.assertDecode("8888888888888888888888888888888888888888");
      const depthFetches: number[] = [];
      let catFileChecks = 0;
      let checkedOutPinnedCommit = false;

      const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = await expectPinnedCheckoutFailure(
        pinnedCommitSha,
        {
          projectIdValue: "prj_4444444444444444444444",
          runIdValue: "run_4444444444444444444444",
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

            const depthMatch = command.match(/fetch --depth=(\d+)/u);
            if (depthMatch) {
              const depth = Number(depthMatch[1]);
              depthFetches.push(depth);
              events.push(`fetch-depth-${depth}`);
              return createExecResult();
            }

            if (command.includes(`fetch origin '${pinnedCommitSha}'`)) {
              events.push("fetch-exact-sha");
              return createExecResult();
            }

            if (command.includes("fetch --unshallow")) {
              events.push("fetch-unshallow");
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
                stdout: `${checkedOutPinnedCommit ? pinnedCommitSha : rewrittenHeadSha}\n`,
              });
            }

            throw new Error(`Unexpected exec command: ${command}`);
          },
        },
      );

      await expect(prepareExecutionEnvironment(context, createLeaseStub())).rejects.toThrow(
        "Repository config is not valid YAML",
      );

      expect(recordRunResolvedCommit).toHaveBeenCalledWith({
        projectId,
        runId,
        commitSha: pinnedCommitSha,
      });
      expect(depthFetches).toEqual([1, 2, 4, 8, 16, 32, 64]);
      expect(catFileChecks).toBe(9);
      expect(events.indexOf("fetch-exact-sha")).toBeGreaterThan(events.indexOf("cat-file-8"));
      expect(events.indexOf("cat-file-9")).toBeGreaterThan(events.indexOf("fetch-exact-sha"));
      expect(events.indexOf("checkout-detached")).toBeGreaterThan(events.indexOf("cat-file-9"));
      expect(events).not.toContain("fetch-unshallow");
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toBeNull();
    });

    it("unshallows pinned history only as a last resort after exact-SHA fetches", async () => {
      const rewrittenHeadSha = CommitSha.assertDecode("9999999999999999999999999999999999999999");
      const pinnedCommitSha = CommitSha.assertDecode("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      const depthFetches: number[] = [];
      let catFileChecks = 0;
      let checkedOutPinnedCommit = false;

      const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = await expectPinnedCheckoutFailure(
        pinnedCommitSha,
        {
          projectIdValue: "prj_5555555555555555555555",
          runIdValue: "run_5555555555555555555555",
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

            const depthMatch = command.match(/fetch --depth=(\d+)/u);
            if (depthMatch) {
              const depth = Number(depthMatch[1]);
              depthFetches.push(depth);
              events.push(`fetch-depth-${depth}`);
              return createExecResult();
            }

            if (command.includes(`fetch origin '${pinnedCommitSha}'`)) {
              events.push("fetch-exact-sha");
              return createExecResult();
            }

            if (command.includes("fetch --unshallow --update-shallow origin")) {
              events.push("fetch-unshallow");
              return createExecResult();
            }

            if (command.includes("cat-file -e")) {
              catFileChecks += 1;
              events.push(`cat-file-${catFileChecks}`);
              return createExecResult({
                success: events.includes("fetch-unshallow"),
                stderr: events.includes("fetch-unshallow") ? "" : "fatal: Not a valid object name",
              });
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
                stdout: `${checkedOutPinnedCommit ? pinnedCommitSha : rewrittenHeadSha}\n`,
              });
            }

            throw new Error(`Unexpected exec command: ${command}`);
          },
        },
      );

      await expect(prepareExecutionEnvironment(context, createLeaseStub())).rejects.toThrow(
        "Repository config is not valid YAML",
      );

      expect(recordRunResolvedCommit).toHaveBeenCalledWith({
        projectId,
        runId,
        commitSha: pinnedCommitSha,
      });
      expect(depthFetches).toEqual([1, 2, 4, 8, 16, 32, 64]);
      expect(catFileChecks).toBe(10);
      expect(events.indexOf("fetch-exact-sha")).toBeGreaterThan(events.indexOf("cat-file-8"));
      expect(events.indexOf("cat-file-9")).toBeGreaterThan(events.indexOf("fetch-exact-sha"));
      expect(events.indexOf("fetch-unshallow")).toBeGreaterThan(events.indexOf("cat-file-9"));
      expect(events.indexOf("cat-file-10")).toBeGreaterThan(events.indexOf("fetch-unshallow"));
      expect(events.indexOf("checkout-detached")).toBeGreaterThan(events.indexOf("cat-file-10"));
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toBeNull();
    });

    it("falls back to a non-shallow exact-SHA fetch when shallow requests are unsupported", async () => {
      const rewrittenHeadSha = CommitSha.assertDecode("dddddddddddddddddddddddddddddddddddddddd");
      const pinnedCommitSha = CommitSha.assertDecode("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      let catFileChecks = 0;
      let checkedOutPinnedCommit = false;

      const { context, events, projectId, recordRunResolvedCommit, runId, sandbox } = await expectPinnedCheckoutFailure(
        pinnedCommitSha,
        {
          projectIdValue: "prj_6666666666666666666666",
          runIdValue: "run_6666666666666666666666",
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
                stderr: "fatal: Server does not support shallow requests",
              });
            }

            if (command.includes(`fetch origin '${pinnedCommitSha}'`)) {
              events.push("fetch-exact-sha");
              return createExecResult();
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

      await expect(prepareExecutionEnvironment(context, createLeaseStub())).rejects.toThrow(
        "Repository config is not valid YAML",
      );

      expect(recordRunResolvedCommit).toHaveBeenCalledWith({
        projectId,
        runId,
        commitSha: pinnedCommitSha,
      });
      expect(events.indexOf("fetch-exact-sha")).toBeGreaterThan(events.indexOf("fetch-depth-1"));
      expect(events.indexOf("cat-file-2")).toBeGreaterThan(events.indexOf("fetch-exact-sha"));
      expect(events.indexOf("checkout-detached")).toBeGreaterThan(events.indexOf("cat-file-2"));
      expect(sandbox.deleteSession).toHaveBeenCalledWith("checkout-session");
      expect(context.state.session).toBeNull();
    });
  });
});
