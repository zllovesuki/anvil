import type { WebhookDeliveryOutcome, WebhookProvider } from "@/contracts";
import { Container, Github, Gitlab } from "lucide-react";
import { webhookProviderCatalogList } from "@/lib/webhooks";

const PROVIDER_ICONS: Record<WebhookProvider, React.FC<{ className?: string }>> = {
  github: Github,
  gitlab: Gitlab,
  gitea: Container,
};

export const getWebhookProviderIcon = (provider: WebhookProvider) => {
  const Icon = PROVIDER_ICONS[provider];
  return <Icon className="h-4 w-4" />;
};

const HOSTNAME_PROVIDER_HINTS: ReadonlyArray<{ pattern: string; provider: WebhookProvider }> =
  webhookProviderCatalogList.flatMap((entry) => {
    const hints: Array<{ pattern: string; provider: WebhookProvider }> = [
      { pattern: entry.provider, provider: entry.provider },
    ];
    if (entry.provider === "gitea") {
      hints.push({ pattern: "codeberg", provider: "gitea" });
    }
    return hints;
  });

export const getRecommendedProvider = (repoUrl: string): WebhookProvider | null => {
  try {
    const hostname = new URL(repoUrl).hostname.replace(/^www\./u, "");
    return HOSTNAME_PROVIDER_HINTS.find((h) => hostname.includes(h.pattern))?.provider ?? null;
  } catch {
    return null;
  }
};

export const DELIVERY_OUTCOME_META: Record<
  WebhookDeliveryOutcome,
  { label: string; variant: "success" | "warning" | "error" | "default" }
> = {
  accepted: { label: "Accepted", variant: "success" },
  ignored_ping: { label: "Ping", variant: "default" },
  ignored_event: { label: "Ignored Event", variant: "warning" },
  ignored_branch: { label: "Ignored Branch", variant: "warning" },
  queue_full: { label: "Queue Full", variant: "error" },
};
