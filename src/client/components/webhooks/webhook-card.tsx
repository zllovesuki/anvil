import type { WebhookProvider, WebhookSummary } from "@/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Webhook } from "lucide-react";
import { useCallback, useState } from "react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBanner } from "@/client/components/ui";
import { formatApiError, getApiClient, queryKeys } from "@/client/lib";
import { useToast } from "@/client/toast";
import { AddWebhookDialog } from "@/client/components/webhooks/add-webhook-dialog";
import { DeliveryListDialog } from "@/client/components/webhooks/delivery-list-dialog";
import { RotateSecretDialog } from "@/client/components/webhooks/rotate-secret-dialog";
import { SecretRevealDialog } from "@/client/components/webhooks/secret-reveal-dialog";
import { WebhookRow } from "@/client/components/webhooks/webhook-row";
import { getRecommendedProvider } from "@/client/components/webhooks/webhook-presentation";
import { webhookProviderCatalog } from "@/lib/webhooks";

interface WebhookCardProps {
  projectId: string;
  project: { ownerSlug: string; projectSlug: string; repoUrl: string };
}

export const WebhookCard = ({ projectId, project }: WebhookCardProps) => {
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [togglingProvider, setTogglingProvider] = useState<string | null>(null);

  // Dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [secretReveal, setSecretReveal] = useState<{
    provider: WebhookProvider;
    secret: string;
    webhookUrl: string;
  } | null>(null);
  const [rotateWebhook, setRotateWebhook] = useState<WebhookSummary | null>(null);
  const [deliveriesWebhook, setDeliveriesWebhook] = useState<WebhookSummary | null>(null);
  const [deleteWebhook, setDeleteWebhook] = useState<WebhookSummary | null>(null);

  const buildWebhookUrl = (provider: string) =>
    `${window.location.origin}/api/public/hooks/${provider}/${project.ownerSlug}/${project.projectSlug}`;

  const webhooksQuery = useQuery({
    queryKey: queryKeys.projectWebhooks(projectId),
    queryFn: () => getApiClient().getProjectWebhooks(projectId),
  });

  const refreshWebhooks = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.projectWebhooks(projectId) });
  }, [projectId, queryClient]);

  const handleToggle = async (webhook: WebhookSummary) => {
    setTogglingProvider(webhook.provider);
    try {
      await getApiClient().updateWebhook(projectId, webhook.provider, {
        enabled: !webhook.enabled,
      });
      pushToast({
        tone: "success",
        title: webhook.enabled ? "Webhook disabled" : "Webhook enabled",
      });
      await refreshWebhooks();
    } catch (reason) {
      pushToast({ tone: "error", title: "Toggle failed", message: formatApiError(reason) });
    } finally {
      setTogglingProvider(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteWebhook) return;
    const provider = deleteWebhook.provider;
    const displayName = webhookProviderCatalog[provider].displayName;

    try {
      await getApiClient().deleteWebhook(projectId, provider);
      pushToast({ tone: "success", title: `${displayName} webhook deleted` });
      setDeleteWebhook(null);
      await refreshWebhooks();
    } catch (reason) {
      pushToast({ tone: "error", title: "Delete failed", message: formatApiError(reason) });
      setDeleteWebhook(null);
    }
  };

  const handleCreated = (provider: WebhookProvider, generatedSecret: string | null, webhookUrl: string) => {
    void refreshWebhooks();
    if (generatedSecret) {
      setSecretReveal({ provider, secret: generatedSecret, webhookUrl });
    }
  };

  const recommended = getRecommendedProvider(project.repoUrl);
  const webhooks = webhooksQuery.data?.webhooks ?? [];
  const configuredProviders = webhooks.map((w) => w.provider);
  const error = webhooksQuery.isError ? formatApiError(webhooksQuery.error) : null;
  const loading = webhooksQuery.isPending;

  return (
    <>
      <Card>
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">Webhooks</p>
          <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAddOpen(true)}>
            Add
          </Button>
        </div>

        {loading ? (
          <p className="mt-3 text-sm text-zinc-500">Loading...</p>
        ) : error ? (
          <ErrorBanner message={error} className="mt-3" />
        ) : webhooks.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<Webhook className="h-5 w-5" />}
              title="No webhooks"
              description="Add a webhook to trigger runs automatically."
            />
            {recommended ? (
              <p className="mt-2 text-center text-xs text-zinc-500">
                Recommended: <Badge variant="accent">{webhookProviderCatalog[recommended].displayName}</Badge>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {webhooks.map((webhook) => (
              <WebhookRow
                key={webhook.id}
                webhook={webhook}
                toggling={togglingProvider === webhook.provider}
                onToggle={() => void handleToggle(webhook)}
                onViewDeliveries={() => setDeliveriesWebhook(webhook)}
                onRotateSecret={() => setRotateWebhook(webhook)}
                onDelete={() => setDeleteWebhook(webhook)}
              />
            ))}
          </div>
        )}
      </Card>

      <AddWebhookDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectId={projectId}
        project={project}
        configuredProviders={configuredProviders}
        onCreated={handleCreated}
      />

      {secretReveal ? (
        <SecretRevealDialog
          open
          onClose={() => setSecretReveal(null)}
          secret={secretReveal.secret}
          provider={secretReveal.provider}
          webhookUrl={secretReveal.webhookUrl}
        />
      ) : null}

      {rotateWebhook ? (
        <RotateSecretDialog
          open
          onClose={() => setRotateWebhook(null)}
          webhook={rotateWebhook}
          webhookUrl={buildWebhookUrl(rotateWebhook.provider)}
          onRotated={() => void refreshWebhooks()}
        />
      ) : null}

      {deliveriesWebhook ? (
        <DeliveryListDialog open onClose={() => setDeliveriesWebhook(null)} webhook={deliveriesWebhook} />
      ) : null}

      <ConfirmDialog
        open={deleteWebhook !== null}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteWebhook(null)}
        title="Delete webhook"
        description={
          deleteWebhook
            ? `Remove the ${webhookProviderCatalog[deleteWebhook.provider].displayName} webhook? Incoming deliveries from this provider will no longer trigger runs.`
            : ""
        }
        confirmLabel="Delete"
        variant="danger"
      />
    </>
  );
};
