import { type ExecutionSession, type Sandbox, type SessionOptions } from "@cloudflare/sandbox";
import { isNoContainerInstanceError } from "@/worker/sandbox/container-errors";

// This file exists due to @cloudflare/sandbox not exporting the error types
// see: https://github.com/cloudflare/sandbox-sdk/issues/517

const SESSION_ALREADY_EXISTS_CODE = "SESSION_ALREADY_EXISTS";
const SESSION_ALREADY_EXISTS_NAME = "SessionAlreadyExistsError";
const SESSION_DESTROYED_CODE = "SESSION_DESTROYED";
const SESSION_DESTROYED_NAME = "SessionDestroyedError";
const SESSION_ALREADY_EXISTS_PREFIX = `${SESSION_ALREADY_EXISTS_NAME}:`;
const SESSION_DESTROYED_PREFIX = `${SESSION_DESTROYED_NAME}:`;

const getErrorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  const { code } = error as { code?: unknown };
  return typeof code === "string" ? code : null;
};

const getErrorName = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return null;
  }

  const { name } = error as { name?: unknown };
  return typeof name === "string" ? name : null;
};

const getErrorMessage = (error: unknown): string | null => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error !== "object" || error === null || !("message" in error)) {
    return null;
  }

  const { message } = error as { message?: unknown };
  return typeof message === "string" ? message : null;
};

const hasErrorMessagePrefix = (error: unknown, prefix: string): boolean =>
  getErrorMessage(error)?.startsWith(prefix) === true;

export const getOrCreateSandboxSession = async (
  runtime: {
    sandbox: Pick<Sandbox, "createSession">;
    getSession(sessionId: string): Promise<ExecutionSession>;
  },
  options: Required<Pick<SessionOptions, "id">> & Pick<SessionOptions, "cwd" | "env" | "commandTimeoutMs">,
): Promise<ExecutionSession> => {
  try {
    return await runtime.sandbox.createSession(options);
  } catch (error) {
    if (
      getErrorCode(error) !== SESSION_ALREADY_EXISTS_CODE &&
      getErrorName(error) !== SESSION_ALREADY_EXISTS_NAME &&
      !hasErrorMessagePrefix(error, SESSION_ALREADY_EXISTS_PREFIX)
    ) {
      throw error;
    }

    return await runtime.getSession(options.id);
  }
};

export const deleteSandboxSessionIfExists = async (
  sandbox: Pick<Sandbox, "deleteSession">,
  sessionId: string,
): Promise<void> => {
  try {
    await sandbox.deleteSession(sessionId);
  } catch (error) {
    if (
      isNoContainerInstanceError(error) ||
      getErrorCode(error) === SESSION_DESTROYED_CODE ||
      getErrorName(error) === SESSION_DESTROYED_NAME ||
      hasErrorMessagePrefix(error, SESSION_DESTROYED_PREFIX)
    ) {
      return;
    }

    throw error;
  }
};
