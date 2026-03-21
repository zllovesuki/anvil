import { RunQueueMessage } from "@/worker/contracts";

import { logger } from "@/worker/queue/run-execution-context";
import { executeDispatchedRun } from "@/worker/queue/execute-dispatched-run";

const processQueueMessage = async (message: Message<unknown>, env: Env): Promise<void> => {
  const payload = RunQueueMessage.assertDecode(message.body);

  const result = await executeDispatchedRun(env, {
    projectId: payload.projectId,
    runId: payload.runId,
  });

  switch (result.kind) {
    case "project_missing":
      logger.warn("stale_queue_delivery", {
        queueMessageId: message.id,
        projectId: payload.projectId,
        runId: payload.runId,
        reason: "project_missing",
      });
      break;

    case "recovered":
      logger.info("recovered_active_queue_delivery", {
        queueMessageId: message.id,
        projectId: payload.projectId,
        runId: payload.runId,
      });
      break;

    case "stale":
      logger.info("stale_queue_delivery", {
        queueMessageId: message.id,
        projectId: payload.projectId,
        runId: payload.runId,
        reason: result.reason,
      });
      break;

    case "executed":
      break;
  }

  message.ack();
};

export const handleQueueBatch = async (batch: MessageBatch<RunQueueMessage>, env: Env): Promise<void> => {
  for (const message of batch.messages) {
    logger.info("queue_message_received", { queueMessageId: message.id });

    try {
      await processQueueMessage(message, env);
    } catch (error) {
      logger.error("queue_message_failed", {
        queueMessageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry();
    }
  }
};
