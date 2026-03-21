import type { WebhookProvider, WebhookProviderConfig } from "@/contracts";
import { ApiError } from "@/client/lib/api-contract";
import { getWebhookProviderCatalogEntry } from "@/lib/webhooks";

export const MOCK_DB_KEY = "anvil.mock.db.v1";
export const ENTITY_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const SESSION_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

export const randomString = (alphabet: string, length: number): string => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
};

export const randomEntityId = (prefix: "usr" | "prj" | "inv" | "run" | "whk"): string =>
  `${prefix}_${randomString(ENTITY_ID_ALPHABET, 22)}`;

export const randomSessionId = (): string => randomString(SESSION_ID_ALPHABET, 32);

export const nowIso = (): string => new Date().toISOString();

export const plusHoursIso = (hours: number): string => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

export const toSlug = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `user-${randomString("abcdefghijklmnopqrstuvwxyz0123456789", 6)}`;
};

export const simpleHash = (value: string): string => {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return `mock-hash-${Math.abs(hash).toString(36)}`;
};

export const assertMockWebhookConfigAllowed = (input: {
  provider: WebhookProvider;
  config: WebhookProviderConfig | null | undefined;
  creating: boolean;
}): void => {
  const entry = getWebhookProviderCatalogEntry(input.provider);

  if (input.config === undefined) {
    if (input.creating && entry.configMode === "required") {
      throw new ApiError(
        400,
        "invalid_webhook_provider_config",
        `${entry.displayName} webhooks require instanceUrl in v1.`,
      );
    }
    return;
  }

  if (input.config === null) {
    if (entry.configMode === "required") {
      throw new ApiError(
        400,
        "invalid_webhook_provider_config",
        `${entry.displayName} webhooks require instanceUrl in v1.`,
      );
    }
    return;
  }

  if (entry.configMode === "forbidden") {
    throw new ApiError(
      400,
      "invalid_webhook_provider_config",
      `${entry.displayName} webhooks do not support a custom instanceUrl in v1.`,
    );
  }
};
