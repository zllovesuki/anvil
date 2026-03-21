import { ProjectId, type WebhookProvider as WebhookProviderValue } from "@/contracts";
import {
  type RecordVerifiedWebhookDeliveryResult,
  type WebhookTriggerPayload,
  expectTrusted,
} from "@/worker/contracts";
import { createLogger } from "@/worker/services";
import { findProjectBySlugs } from "@/worker/db/d1/repositories";
import { requireWebhookProvider, resolveExpectedWebhookInstanceUrl } from "@/worker/api/webhook-shared";
import {
  type WebhookProviderCatalogEntry,
  getWebhookProviderCatalogEntry,
  isRepositoryUrlWithinInstance,
} from "@/lib/webhooks";
import type { AppContext } from "@/worker/hono";
import { HttpError } from "@/worker/http";
import { normalizeRepositoryUrl, normalizeWebhookInstanceUrl } from "@/worker/validation";

import { assertExpectedWebhookContentType, requirePublicSlug } from "./request";
import { verifyProviderWebhook } from "./verification";

const logger = createLogger("worker.webhooks");

const canonicalizeRepositoryIdentity = (provider: WebhookProviderValue, normalizedRepoUrl: string): string => {
  if (provider !== "github") {
    return normalizedRepoUrl;
  }

  const url = new URL(normalizedRepoUrl);
  const normalizedPath = url.pathname
    .split("/")
    .map((segment) => segment.toLowerCase())
    .join("/");

  return `https://${url.host}${normalizedPath}`;
};

const requireRepositoryMatch = (
  provider: WebhookProviderValue,
  normalizedPayloadRepoUrl: string,
  normalizedProjectRepoUrl: string,
  expectedInstanceUrl: string | null,
): void => {
  if (expectedInstanceUrl && !isRepositoryUrlWithinInstance(normalizedProjectRepoUrl, expectedInstanceUrl)) {
    throw new HttpError(500, "invalid_webhook_config", "Webhook config is invalid.");
  }

  if (
    canonicalizeRepositoryIdentity(provider, normalizedPayloadRepoUrl) !==
    canonicalizeRepositoryIdentity(provider, normalizedProjectRepoUrl)
  ) {
    throw new HttpError(403, "webhook_repo_mismatch", "Webhook repository does not match the configured project.");
  }
};

const classifyOutcome = (
  payload: WebhookTriggerPayload,
  defaultBranch: string,
): RecordVerifiedWebhookDeliveryResult["outcome"] => {
  if (payload.eventKind === "ping") {
    return "ignored_ping";
  }

  if (payload.eventKind !== "push" || payload.branch === null) {
    return "ignored_event";
  }

  if (payload.branch !== defaultBranch) {
    return "ignored_branch";
  }

  if (payload.commitSha === null) {
    return "ignored_event";
  }

  return "accepted";
};

const mapDeliveryResponseStatus = (
  catalog: WebhookProviderCatalogEntry,
  result: RecordVerifiedWebhookDeliveryResult,
): number => {
  if (result.outcome === "queue_full") {
    return catalog.queueFullResponseStatus;
  }

  if (result.duplicate) {
    return 200;
  }

  if (result.outcome === "accepted") {
    return 202;
  }

  return 200;
};

export const handleWebhook = async (c: AppContext): Promise<Response> => {
  const provider = requireWebhookProvider(c.req.param("provider"));
  const ownerSlug = requirePublicSlug(c.req.param("ownerSlug"), "ownerSlug");
  const projectSlug = requirePublicSlug(c.req.param("projectSlug"), "projectSlug");
  const catalog = getWebhookProviderCatalogEntry(provider);

  assertExpectedWebhookContentType(catalog, c.req.raw);

  const project = await findProjectBySlugs(c.get("db"), ownerSlug, projectSlug);
  if (!project) {
    throw new HttpError(404, "webhook_not_found", "Webhook was not found.");
  }

  const projectId = expectTrusted(ProjectId, project.id, "ProjectId");
  const projectStub = c.env.PROJECT_DO.getByName(projectId);
  const ingressState = await projectStub.getProjectWebhookIngressState(projectId, provider);
  if (!ingressState || !ingressState.webhook.enabled) {
    throw new HttpError(404, "webhook_not_found", "Webhook was not found.");
  }

  const body = new Uint8Array(await c.req.raw.arrayBuffer());
  const payload = await verifyProviderWebhook(provider, catalog, c.env, c.req.raw, ingressState.webhook, body);
  const normalizedProjectRepoUrl = normalizeRepositoryUrl(ingressState.repoUrl);
  const rawExpectedInstanceUrl = resolveExpectedWebhookInstanceUrl(provider, ingressState.webhook.config);
  const expectedInstanceUrl =
    rawExpectedInstanceUrl === null ? null : normalizeWebhookInstanceUrl(rawExpectedInstanceUrl);
  requireRepositoryMatch(provider, payload.repoUrl, normalizedProjectRepoUrl, expectedInstanceUrl);

  const outcome = classifyOutcome(payload, ingressState.defaultBranch);
  const result = await projectStub.recordVerifiedWebhookDelivery({
    projectId,
    payload,
    outcome,
    verifiedWebhookUpdatedAt: ingressState.webhook.updatedAt,
  });
  if (result.staleVerification) {
    throw new HttpError(409, "stale_webhook_verification", "Webhook verification material is stale.");
  }

  if (result.outcome === "accepted") {
    c.executionCtx.waitUntil(
      projectStub.kickReconciliation().catch((error) => {
        logger.warn("webhook_reconciliation_kick_failed", {
          projectId,
          provider,
          deliveryId: payload.deliveryId,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    );
  }

  logger.info("webhook_delivery_processed", {
    projectId,
    provider,
    deliveryId: payload.deliveryId,
    outcome: result.outcome,
    duplicate: result.duplicate,
    runId: result.runId,
  });

  const headers = new Headers();
  if (result.outcome === "queue_full" && catalog.queueFullRetryAfterSeconds !== null) {
    // Providers that support receiver backpressure should retry this delivery later.
    headers.set("retry-after", catalog.queueFullRetryAfterSeconds);
  }

  return new Response(null, { status: mapDeliveryResponseStatus(catalog, result), headers });
};
