import { GetMeResponse } from "@/contracts";
import type { AppContext } from "@/worker/hono";
import { serializeUserSummary } from "@/worker/presentation/serializers";
import { getConfig } from "@/worker/config";

export const handleGetMe = async (c: AppContext): Promise<Response> => {
  return c.json(
    GetMeResponse.assertDecode({
      user: serializeUserSummary(c.get("user")),
      inviteTtlSeconds: getConfig(c.env).inviteTtlSeconds,
    }),
    200,
  );
};
