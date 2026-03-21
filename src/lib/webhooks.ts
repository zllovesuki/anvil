import type { WebhookProvider, WebhookProviderConfig } from "@/contracts";

export type WebhookConfigMode = "forbidden" | "optional" | "required";
export type WebhookVerificationKind = "hmac-sha256" | "shared-secret";
export type WebhookQueueFullResponseStatus = 200 | 503;

export interface WebhookProviderCatalogEntry {
  provider: WebhookProvider;
  displayName: string;
  docsUrl: string;
  requiredHttpMethod: "POST";
  expectedContentType: "application/json";
  expectedSecretField: string;
  requiredHeaders: readonly string[];
  deliveryIdHeaders: readonly string[];
  eventHeader: string;
  verificationHeader: string;
  verificationKind: WebhookVerificationKind;
  verificationPrefix: string | null;
  configMode: WebhookConfigMode;
  defaultInstanceUrl: string | null;
  queueFullResponseStatus: WebhookQueueFullResponseStatus;
  queueFullRetryAfterSeconds: string | null;
  setupInstructions: readonly string[];
}

export const inferWebhookInstanceUrl = (provider: WebhookProvider, repoUrl: string): string => {
  try {
    const url = new URL(repoUrl);
    if (provider === "gitea") {
      const segments = url.pathname.replace(/\/$/u, "").split("/").filter(Boolean);
      if (segments.length >= 2) {
        url.pathname = segments.slice(0, -2).join("/") || "/";
      }
      return url.origin + (url.pathname === "/" ? "" : url.pathname.replace(/\/$/u, ""));
    }

    return url.origin;
  } catch {
    return "";
  }
};

export const webhookProviderCatalog = {
  github: {
    provider: "github",
    displayName: "GitHub",
    docsUrl: "https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks",
    requiredHttpMethod: "POST",
    expectedContentType: "application/json",
    expectedSecretField: "Secret",
    requiredHeaders: ["X-Hub-Signature-256", "X-GitHub-Event"],
    deliveryIdHeaders: ["X-GitHub-Delivery"],
    eventHeader: "X-GitHub-Event",
    verificationHeader: "X-Hub-Signature-256",
    verificationKind: "hmac-sha256",
    verificationPrefix: "sha256=",
    configMode: "forbidden",
    defaultInstanceUrl: null,
    queueFullResponseStatus: 503,
    queueFullRetryAfterSeconds: "60",
    setupInstructions: [
      "Repository Settings > Webhooks > Add webhook",
      "Set Content type to application/json",
      "Subscribe to push events",
      "Save the secret exactly as shown once",
    ],
  },
  gitlab: {
    provider: "gitlab",
    displayName: "GitLab",
    docsUrl: "https://docs.gitlab.com/user/project/integrations/webhooks/",
    requiredHttpMethod: "POST",
    expectedContentType: "application/json",
    expectedSecretField: "Secret token",
    requiredHeaders: ["X-Gitlab-Token", "X-Gitlab-Event"],
    // GitLab 17.4+ sends Idempotency-Key and preserves it across retries of the same delivery.
    // Manual redelivery gets a new X-Gitlab-Event-UUID, and older GitLab versions only send that UUID,
    // so keep Idempotency-Key first and X-Gitlab-Event-UUID as the ordered fallback.
    deliveryIdHeaders: ["Idempotency-Key", "X-Gitlab-Event-UUID"],
    eventHeader: "X-Gitlab-Event",
    verificationHeader: "X-Gitlab-Token",
    verificationKind: "shared-secret",
    verificationPrefix: null,
    configMode: "optional",
    defaultInstanceUrl: "https://gitlab.com",
    // GitLab counts 4xx/5xx receiver responses as delivery failures, so keep
    // queue pressure as an internal audit outcome instead of returning 503.
    queueFullResponseStatus: 200,
    queueFullRetryAfterSeconds: null,
    setupInstructions: [
      "Project Settings > Webhooks > Add new webhook",
      "Enable push events",
      "Leave custom webhook templates disabled in v1",
      "Use the generated secret token exactly once when creating the hook",
    ],
  },
  gitea: {
    provider: "gitea",
    displayName: "Gitea",
    docsUrl: "https://docs.gitea.com/usage/repository/webhooks",
    requiredHttpMethod: "POST",
    expectedContentType: "application/json",
    expectedSecretField: "Secret",
    requiredHeaders: ["X-Gitea-Signature", "X-Gitea-Event"],
    deliveryIdHeaders: ["X-Gitea-Delivery"],
    eventHeader: "X-Gitea-Event",
    verificationHeader: "X-Gitea-Signature",
    verificationKind: "hmac-sha256",
    verificationPrefix: null,
    configMode: "required",
    defaultInstanceUrl: null,
    queueFullResponseStatus: 503,
    queueFullRetryAfterSeconds: "60",
    setupInstructions: [
      "Repository Settings > Webhooks > Gitea",
      "Set POST Content Type to application/json",
      "Trigger on push events",
      "Use the generated secret exactly as shown once",
    ],
  },
} as const satisfies Record<WebhookProvider, WebhookProviderCatalogEntry>;

export const webhookProviderCatalogList = Object.values(webhookProviderCatalog);

export const getWebhookProviderCatalogEntry = (provider: WebhookProvider): WebhookProviderCatalogEntry =>
  webhookProviderCatalog[provider];

const normalizeContentType = (value: string | null): string | null =>
  value?.split(";")[0]?.trim().toLowerCase() ?? null;

export const matchesWebhookRequestMethod = (
  catalog: Pick<WebhookProviderCatalogEntry, "requiredHttpMethod">,
  method: string,
): boolean => method.toUpperCase() === catalog.requiredHttpMethod;

export const matchesWebhookRequestContentType = (
  catalog: Pick<WebhookProviderCatalogEntry, "expectedContentType">,
  contentType: string | null,
): boolean => normalizeContentType(contentType) === catalog.expectedContentType;

export type WebhookConfigValidationResult =
  | { ok: true; config: WebhookProviderConfig | null }
  | { ok: false; status: number; code: string; message: string };

export const isRepositoryUrlWithinInstance = (repositoryUrl: string, instanceUrl: string): boolean =>
  repositoryUrl.startsWith(`${instanceUrl}/`);

export const validateWebhookConfig = (input: {
  provider: WebhookProvider;
  config: WebhookProviderConfig | null;
  projectRepoUrl: string;
}): WebhookConfigValidationResult => {
  const providerEntry = getWebhookProviderCatalogEntry(input.provider);
  const defaultInstanceUrl = providerEntry.defaultInstanceUrl;

  if (input.config === null) {
    switch (providerEntry.configMode) {
      case "forbidden": {
        if (input.provider === "github") {
          if (!isRepositoryUrlWithinInstance(input.projectRepoUrl, "https://github.com")) {
            return {
              ok: false,
              status: 400,
              code: "invalid_webhook_provider_config",
              message: `${providerEntry.displayName} webhooks require a repository URL served by https://github.com.`,
            };
          }
        }
        return { ok: true, config: null };
      }
      case "optional": {
        if (!defaultInstanceUrl) {
          return {
            ok: false,
            status: 500,
            code: "invalid_webhook_provider_config",
            message: `${providerEntry.displayName} default instance URL is not configured.`,
          };
        }
        if (!isRepositoryUrlWithinInstance(input.projectRepoUrl, defaultInstanceUrl)) {
          return {
            ok: false,
            status: 400,
            code: "invalid_webhook_provider_config",
            message: `${providerEntry.displayName} webhooks require a repository URL served by ${defaultInstanceUrl}.`,
          };
        }
        return { ok: true, config: null };
      }
      case "required":
        return {
          ok: false,
          status: 400,
          code: "invalid_webhook_provider_config",
          message: `${providerEntry.displayName} webhooks require instanceUrl in v1.`,
        };
    }
  }

  if (providerEntry.configMode === "forbidden") {
    return {
      ok: false,
      status: 400,
      code: "invalid_webhook_provider_config",
      message: `${providerEntry.displayName} webhooks do not support a custom instanceUrl in v1.`,
    };
  }

  if (!isRepositoryUrlWithinInstance(input.projectRepoUrl, input.config.instanceUrl)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_webhook_provider_config",
      message: `${providerEntry.displayName} webhooks require a repository URL served by ${input.config.instanceUrl}.`,
    };
  }

  if (providerEntry.configMode === "optional" && input.config.instanceUrl === defaultInstanceUrl) {
    return { ok: true, config: null };
  }

  return { ok: true, config: { instanceUrl: input.config.instanceUrl } };
};

export const validateWebhookConfigForUpsert = (input: {
  provider: WebhookProvider;
  projectRepoUrl: string;
  incomingConfig: WebhookProviderConfig | null | undefined;
  existingConfig: WebhookProviderConfig | null;
  creating: boolean;
}): WebhookConfigValidationResult => {
  const config =
    input.incomingConfig === undefined ? (input.creating ? null : input.existingConfig) : input.incomingConfig;
  return validateWebhookConfig({ provider: input.provider, config, projectRepoUrl: input.projectRepoUrl });
};
