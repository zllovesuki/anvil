import { describe, expect, it, vi } from "vitest";

import { deleteSandboxSessionIfExists, disposeRpcStub, getOrCreateSandboxSession } from "@/worker/dispatch/shared";

const createSessionAlreadyExistsError = (): Error & { code: string } =>
  Object.assign(new Error("session exists"), {
    code: "SESSION_ALREADY_EXISTS",
    name: "SessionAlreadyExistsError",
  });

const createSessionDestroyedError = (): Error & { code: string } =>
  Object.assign(new Error("session destroyed"), {
    code: "SESSION_DESTROYED",
    name: "SessionDestroyedError",
  });

describe("sandbox process helpers", () => {
  it("creates a named session and falls back to getSession when it already exists", async () => {
    const existingSession = { id: "run-session" };
    const runtime = {
      sandbox: {
        createSession: vi.fn().mockRejectedValueOnce(createSessionAlreadyExistsError()),
      },
      getSession: vi.fn(async () => existingSession as never),
    };

    await expect(
      getOrCreateSandboxSession(runtime, {
        id: "run-session",
        cwd: "/workspace/repo",
      }),
    ).resolves.toBe(existingSession);
    expect(runtime.sandbox.createSession).toHaveBeenCalledWith({
      id: "run-session",
      cwd: "/workspace/repo",
    });
    expect(runtime.getSession).toHaveBeenCalledWith("run-session");
  });

  it("falls back to getSession when the runtime only exposes a prefixed message", async () => {
    const existingSession = { id: "run-session" };
    const runtime = {
      sandbox: {
        createSession: vi
          .fn()
          .mockRejectedValueOnce(new Error("SessionAlreadyExistsError: Session 'run-session' already exists")),
      },
      getSession: vi.fn(async () => existingSession as never),
    };

    await expect(
      getOrCreateSandboxSession(runtime, {
        id: "run-session",
        cwd: "/workspace/repo",
      }),
    ).resolves.toBe(existingSession);
    expect(runtime.getSession).toHaveBeenCalledWith("run-session");
  });

  it("treats deleting an already-destroyed session as success", async () => {
    const sandbox = {
      deleteSession: vi.fn(async () => {
        throw createSessionDestroyedError();
      }),
    };

    await expect(deleteSandboxSessionIfExists(sandbox as never, "run-session")).resolves.toBeUndefined();
  });

  it("treats a prefixed destroyed-session message as success", async () => {
    const sandbox = {
      deleteSession: vi.fn(async () => {
        throw new Error("SessionDestroyedError: Session 'run-session' was destroyed");
      }),
    };

    await expect(deleteSandboxSessionIfExists(sandbox as never, "run-session")).resolves.toBeUndefined();
  });

  it("treats a missing running container as success when deleting a session", async () => {
    const sandbox = {
      deleteSession: vi.fn(async () => {
        throw new Error("Error: The container is not running, consider calling start()");
      }),
    };

    await expect(deleteSandboxSessionIfExists(sandbox as never, "run-session")).resolves.toBeUndefined();
  });

  it("swallows async dispose rejections from proxy-backed stubs", async () => {
    const flush = vi.fn(async () => {});
    disposeRpcStub({
      dispose: async () => {
        throw new Error("dispose failed");
      },
    });

    await flush();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
