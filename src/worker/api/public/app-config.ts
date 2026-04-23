import { PublicAppConfigResponse } from "@/contracts";
import type { AppContext } from "@/worker/hono";
import { validateAppEncryptionConfig } from "@/worker/security/secrets";

export const handleAppConfig = async (c: AppContext): Promise<Response> => {
  await validateAppEncryptionConfig(c.env);

  return c.json(
    PublicAppConfigResponse.assertDecode({
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY?.trim() || null,
    }),
    200,
  );
};
