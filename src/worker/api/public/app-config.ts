import type { AppContext } from "@/worker/hono";
import { validateAppEncryptionConfig } from "@/worker/security/secrets";

export const handleAppConfig = async (c: AppContext): Promise<Response> => {
  await validateAppEncryptionConfig(c.env);
  return c.body(null, 204);
};
