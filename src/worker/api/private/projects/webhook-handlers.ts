import {
  CreateWebhookRequest,
  type GetProjectWebhooksResponse,
  type RotateWebhookSecretResponse,
  type UpsertWebhookResponse,
} from "@/contracts";
import { requireOwnedProject } from "@/worker/api/private/shared";
import type { AppContext } from "@/worker/hono";
import { HttpError, parseJson } from "@/worker/http";
import { serializeWebhookSummary } from "@/worker/presentation/serializers";
import { encryptSecret, type EncryptedSecret } from "@/worker/security/secrets";
import { generateOpaqueToken } from "@/worker/services";
import { getProjectStub, logger, normalizeWebhookConfigIfPresent, requireWebhookProviderParam } from "./shared";

const assertWebhookSecret = (secret: string): string => {
  if (secret.length === 0) {
    throw new HttpError(400, "invalid_webhook_secret", "Webhook secret cannot be empty.");
  }

  return secret;
};

const issueWebhookSecret = async (
  env: Env,
  secret = generateOpaqueToken(32),
): Promise<{
  secret: string;
  encryptedSecret: EncryptedSecret;
}> => ({
  secret,
  encryptedSecret: await encryptSecret(env, secret),
});

export const handleGetProjectWebhooks = async (c: AppContext): Promise<Response> => {
  const { projectId } = await requireOwnedProject(c);
  const webhooks = await getProjectStub(c.env, projectId).listProjectWebhooks(projectId);

  const response: GetProjectWebhooksResponse = {
    webhooks: webhooks.map(serializeWebhookSummary),
  };

  return c.json(response, 200);
};

export const handleUpsertProjectWebhook = async (c: AppContext): Promise<Response> => {
  const { projectId } = await requireOwnedProject(c);
  const provider = requireWebhookProviderParam(c);
  const now = Date.now();

  const payload = await parseJson(c.req.raw, CreateWebhookRequest);
  const projectStub = getProjectStub(c.env, projectId);
  const existingWebhook = await projectStub.getWebhookVerificationMaterial(projectId, provider);
  let generatedSecret: string | null = null;
  let encryptedSecret: EncryptedSecret | undefined;
  const creating = existingWebhook === null;

  // Secret is encrypted here even on update; the DO rejects it (secret_not_allowed).
  // Intentional: the DO is the authoritative guard; skipping encryption here would lose defense-in-depth.
  if (payload.secret !== undefined) {
    ({ encryptedSecret } = await issueWebhookSecret(c.env, assertWebhookSecret(payload.secret)));
  } else if (creating) {
    ({ secret: generatedSecret, encryptedSecret } = await issueWebhookSecret(c.env));
  }

  const normalizedConfig = normalizeWebhookConfigIfPresent(payload.config);

  const result = await projectStub.upsertProjectWebhook({
    projectId,
    provider,
    enabled: payload.enabled,
    config: normalizedConfig,
    encryptedSecret,
    creating,
    now,
  });

  switch (result.kind) {
    case "conflict":
      throw new HttpError(
        409,
        "webhook_create_conflict",
        "Webhook already exists. Retry without a secret or rotate the secret instead.",
      );
    case "rejected":
      throw new HttpError(
        400,
        "invalid_webhook_secret",
        "Webhook secret cannot be updated inline. Rotate the secret instead.",
      );
    case "invalid":
      throw new HttpError(result.status as 400 | 404 | 409 | 500, result.code, result.message);
    case "not_found":
      throw new HttpError(404, "webhook_not_found", "Webhook was not found.");
    case "applied":
      break;
  }

  logger.info("project_webhook_upserted", {
    projectId,
    provider,
    created: result.created,
  });

  const response: UpsertWebhookResponse = {
    webhook: serializeWebhookSummary(result.webhook),
    generatedSecret: result.created ? generatedSecret : null,
  };

  return c.json(response, result.created ? 201 : 200);
};

export const handleRotateProjectWebhookSecret = async (c: AppContext): Promise<Response> => {
  const { projectId } = await requireOwnedProject(c);
  const provider = requireWebhookProviderParam(c);
  const { secret, encryptedSecret } = await issueWebhookSecret(c.env);

  const webhook = await getProjectStub(c.env, projectId).rotateProjectWebhookSecret({
    projectId,
    provider,
    encryptedSecret,
    now: Date.now(),
  });

  if (!webhook) {
    throw new HttpError(404, "webhook_not_found", "Webhook was not found.");
  }

  logger.info("project_webhook_secret_rotated", {
    projectId,
    provider,
  });

  const response: RotateWebhookSecretResponse = { secret };
  return c.json(response, 200);
};

export const handleDeleteProjectWebhook = async (c: AppContext): Promise<Response> => {
  const { projectId } = await requireOwnedProject(c);
  const provider = requireWebhookProviderParam(c);

  const deleted = await getProjectStub(c.env, projectId).deleteProjectWebhook({
    projectId,
    provider,
  });

  if (!deleted) {
    throw new HttpError(404, "webhook_not_found", "Webhook was not found.");
  }

  logger.info("project_webhook_deleted", {
    projectId,
    provider,
  });

  return new Response(null, { status: 204 });
};
