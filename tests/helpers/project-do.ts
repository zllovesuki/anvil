import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";

import { ProjectDO } from "@/worker/durable";
import {
  acceptManualRun as acceptManualRunCommand,
  claimRunWork as claimRunWorkCommand,
  finalizeRunExecution as finalizeRunExecutionCommand,
  requestRunCancel as requestRunCancelCommand,
} from "@/worker/durable/project-do/commands";
import type { ProjectDoContext } from "@/worker/durable/project-do/types";
import { createLogger } from "@/worker/services/logger";

type ProjectDoInternals = Pick<ProjectDoContext, "ctx" | "env" | "db">;

export const getProjectDoInternals = (instance: ProjectDO): ProjectDoInternals =>
  instance as unknown as ProjectDoInternals;

export const createTestProjectDoContext = (instance: ProjectDO, envOverride?: Env): ProjectDoContext => {
  const { ctx, env, db } = getProjectDoInternals(instance);

  return {
    ctx,
    env: envOverride ?? env,
    db,
    logger: createLogger("test.project-do"),
    cacheProjectId: (projectId) => {
      (instance as unknown as { cachedProjectId?: string | null }).cachedProjectId = projectId;
    },
  };
};

export const createBoundStorageProxy = (
  storage: DurableObjectStorage,
  overrides: Partial<Pick<DurableObjectStorage, "getAlarm" | "setAlarm" | "transaction">>,
): DurableObjectStorage =>
  new Proxy(storage, {
    get(target, prop, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) {
        return overrides[prop as keyof typeof overrides];
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

export const createBoundTransactionProxy = (
  txn: DurableObjectTransaction,
  overrides: Partial<Pick<DurableObjectTransaction, "setAlarm">>,
): DurableObjectTransaction =>
  new Proxy(txn, {
    get(target, prop, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, prop)) {
        return overrides[prop as keyof typeof overrides];
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

export const withPatchedStorage = (context: ProjectDoContext, storage: DurableObjectStorage): ProjectDoContext => ({
  ...context,
  ctx: Object.assign(Object.create(context.ctx), { storage }) as DurableObjectState,
});

export const createAlarmSchedulingSuppressedContext = (context: ProjectDoContext): ProjectDoContext => {
  const transaction: DurableObjectStorage["transaction"] = async (closure) =>
    context.ctx.storage.transaction(
      async (txn) => await closure(createBoundTransactionProxy(txn, { setAlarm: async () => {} })),
    );
  const storage = createBoundStorageProxy(context.ctx.storage, { transaction });

  return withPatchedStorage(context, storage);
};

export const createAlarmWriteFailingContext = (
  context: ProjectDoContext,
  errorMessage = "alarm write failed",
): ProjectDoContext => {
  const transaction: DurableObjectStorage["transaction"] = async (closure) =>
    context.ctx.storage.transaction(async (txn) => {
      const failingTxn = createBoundTransactionProxy(txn, {
        setAlarm: async () => {
          throw new Error(errorMessage);
        },
      });

      return await closure(failingTxn);
    });
  const storage = createBoundStorageProxy(context.ctx.storage, { transaction });

  return withPatchedStorage(context, storage);
};

export const expectAcceptedManualRun = (
  result: Awaited<ReturnType<typeof acceptManualRunCommand>>,
): Extract<Awaited<ReturnType<typeof acceptManualRunCommand>>, { kind: "accepted" }> => {
  if (result.kind !== "accepted") {
    throw new Error(`Expected accepted manual run, got ${result.kind}:${result.reason}.`);
  }

  return result;
};

export const acceptManualRunWithoutAlarm = async (
  projectStub: ReturnType<typeof env.PROJECT_DO.getByName>,
  input: Parameters<typeof acceptManualRunCommand>[1],
): Promise<Extract<Awaited<ReturnType<typeof acceptManualRunCommand>>, { kind: "accepted" }>> => {
  let accepted: Awaited<ReturnType<typeof acceptManualRunCommand>> | null = null;

  await runInDurableObject(projectStub, async (instance: ProjectDO) => {
    const context = createAlarmSchedulingSuppressedContext(createTestProjectDoContext(instance));
    accepted = await acceptManualRunCommand(context, input);
  });

  if (!accepted) {
    throw new Error("acceptManualRunWithoutAlarm did not return an accepted run.");
  }

  return expectAcceptedManualRun(accepted);
};

export const claimRunWorkWithoutAlarm = async (
  projectStub: ReturnType<typeof env.PROJECT_DO.getByName>,
  input: Parameters<typeof claimRunWorkCommand>[1],
): Promise<Awaited<ReturnType<typeof claimRunWorkCommand>>> => {
  let claim: Awaited<ReturnType<typeof claimRunWorkCommand>> | null = null;

  await runInDurableObject(projectStub, async (instance: ProjectDO) => {
    const context = createAlarmSchedulingSuppressedContext(createTestProjectDoContext(instance));
    claim = await claimRunWorkCommand(context, input);
  });

  if (!claim) {
    throw new Error("claimRunWorkWithoutAlarm did not return a claim result.");
  }

  return claim;
};

export const finalizeRunExecutionWithoutAlarm = async (
  projectStub: ReturnType<typeof env.PROJECT_DO.getByName>,
  input: Omit<Parameters<typeof finalizeRunExecutionCommand>[1], "sandboxDestroyed"> & {
    sandboxDestroyed?: boolean;
  },
): Promise<Awaited<ReturnType<typeof finalizeRunExecutionCommand>>> => {
  let result: Awaited<ReturnType<typeof finalizeRunExecutionCommand>> | null = null;

  await runInDurableObject(projectStub, async (instance: ProjectDO) => {
    const context = createAlarmSchedulingSuppressedContext(createTestProjectDoContext(instance));
    result = await finalizeRunExecutionCommand(context, {
      ...input,
      sandboxDestroyed: input.sandboxDestroyed ?? true,
    });
  });

  if (!result) {
    throw new Error("finalizeRunExecutionWithoutAlarm did not return a finalize result.");
  }

  return result;
};

export const requestRunCancelWithoutAlarm = async (
  projectStub: ReturnType<typeof env.PROJECT_DO.getByName>,
  input: Parameters<typeof requestRunCancelCommand>[1],
): Promise<Awaited<ReturnType<typeof requestRunCancelCommand>>> => {
  let result: Awaited<ReturnType<typeof requestRunCancelCommand>> | null = null;

  await runInDurableObject(projectStub, async (instance: ProjectDO) => {
    const context = createAlarmSchedulingSuppressedContext(createTestProjectDoContext(instance));
    result = await requestRunCancelCommand(context, input);
  });

  if (!result) {
    throw new Error("requestRunCancelWithoutAlarm did not return a cancel result.");
  }

  return result;
};
