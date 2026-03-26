import { Sandbox } from "@cloudflare/sandbox";
import { handleQueueBatch } from "@/worker/dispatch/queue/consumer";
import { ProjectDO, RunDO } from "@/worker/durable";
import { app } from "@/worker/router";
import type { RunQueueMessage } from "@/worker/contracts";

const handler: ExportedHandler<Env, RunQueueMessage> = {
  async fetch(request, env, context) {
    return await app.fetch(request, env, context);
  },

  async queue(batch, env) {
    await handleQueueBatch(batch, env);
  },
};

export { ProjectDO, RunDO, Sandbox };
export default handler;
