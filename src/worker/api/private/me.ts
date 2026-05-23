import { GetMeResponse } from "@/contracts";
import type { AppContext } from "@/worker/hono";
import { serializeUserSummary } from "@/worker/presentation/serializers";

export const handleGetMe = async (c: AppContext): Promise<Response> => {
  return c.json(
    GetMeResponse.assertDecode({
      user: serializeUserSummary(c.get("user")),
    }),
    200,
  );
};
