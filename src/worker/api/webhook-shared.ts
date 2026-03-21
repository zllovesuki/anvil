import { type WebhookProviderConfig, WebhookProvider, type WebhookProvider as WebhookProviderType } from "@/contracts";
import {
  toCodecIssueDetails,
  getWebhookProviderCatalogEntry,
  validateWebhookConfigForUpsert as validateConfig,
} from "@/lib";
import type { AppContext } from "@/worker/hono";
import { HttpError } from "@/worker/http";
import { normalizeWebhookInstanceUrl } from "@/worker/validation";
const decodeWebhookProvider = (
  provider: string,
  options?: {
    includeCodecDetails?: boolean;
  },
): WebhookProviderType => {
  try {
    return WebhookProvider.assertDecode(provider);
  } catch (error) {
    throw new HttpError(
      404,
      "webhook_not_found",
      "Webhook was not found.",
      options?.includeCodecDetails ? toCodecIssueDetails(error) : undefined,
    );
  }
};
export const requireWebhookProvider = (
  provider: string | undefined,
  options?: {
    includeCodecDetails?: boolean;
  },
): WebhookProviderType => {
  if (!provider) {
    throw new HttpError(404, "webhook_not_found", "Webhook was not found.");
  }
  return decodeWebhookProvider(provider, options);
};
export const requireWebhookProviderParam = (c: Pick<AppContext, "req">): WebhookProviderType =>
  requireWebhookProvider(c.req.param("provider"), { includeCodecDetails: true });
export const normalizeWebhookConfigIfPresent = (
  config: WebhookProviderConfig | null | undefined,
): WebhookProviderConfig | null | undefined =>
  config !== undefined && config !== null ? { instanceUrl: normalizeWebhookInstanceUrl(config.instanceUrl) } : config;
export const resolveWebhookConfigForUpsert = (input: {
  provider: WebhookProviderType;
  projectRepoUrl: string;
  incomingConfig: WebhookProviderConfig | null | undefined;
  existingConfig: WebhookProviderConfig | null;
  creating: boolean;
}): WebhookProviderConfig | null => {
  const normalizedIncoming = normalizeWebhookConfigIfPresent(input.incomingConfig);
  const result = validateConfig({
    ...input,
    incomingConfig: normalizedIncoming,
  });
  if (!result.ok) {
    throw new HttpError(result.status as 400 | 500, result.code, result.message);
  }
  return result.config;
};
export const resolveExpectedWebhookInstanceUrl = (
  provider: WebhookProviderType,
  config: WebhookProviderConfig | null,
): string | null => {
  const providerEntry = getWebhookProviderCatalogEntry(provider);
  if (config !== null) {
    return config.instanceUrl;
  }
  if (providerEntry.configMode === "required") {
    throw new HttpError(500, "invalid_webhook_config", "Webhook config is invalid.");
  }
  return providerEntry.defaultInstanceUrl;
};
