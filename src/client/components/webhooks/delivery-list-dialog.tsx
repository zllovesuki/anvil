import type { WebhookSummary } from "@/contracts";
import { ExternalLink, GitBranch, GitCommitHorizontal, History } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge, Dialog, EmptyState } from "@/client/components/ui";
import { formatRelativeTime } from "@/client/lib";
import { DELIVERY_OUTCOME_META } from "@/client/components/webhooks/webhook-presentation";
import { webhookProviderCatalog } from "@/lib/webhooks";

interface DeliveryListDialogProps {
  open: boolean;
  onClose: () => void;
  webhook: WebhookSummary;
}

export const DeliveryListDialog = ({ open, onClose, webhook }: DeliveryListDialogProps) => {
  const catalog = webhookProviderCatalog[webhook.provider];
  const deliveries = webhook.recentDeliveries;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`${catalog.displayName} Deliveries`}
      description="Recent webhook deliveries (last 10)"
      icon={<History className="h-5 w-5" />}
    >
      {deliveries.length === 0 ? (
        <EmptyState
          icon={<History className="h-6 w-6" />}
          title="No deliveries yet"
          description="Deliveries will appear here once the provider sends a webhook."
        />
      ) : (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {deliveries.map((delivery) => {
            const meta = DELIVERY_OUTCOME_META[delivery.outcome];
            const commitDisplay = delivery.commitSha ? delivery.commitSha.slice(0, 7) : null;

            return (
              <div key={delivery.deliveryId} className="rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  <span className="text-sm text-zinc-300">{delivery.eventName}</span>
                  <span className="text-xs text-zinc-500">{formatRelativeTime(delivery.receivedAt)}</span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                  {delivery.branch ? (
                    <span className="inline-flex items-center gap-1">
                      <GitBranch className="h-3 w-3" />
                      {delivery.branch}
                    </span>
                  ) : null}
                  {commitDisplay ? (
                    <span className="inline-flex items-center gap-1 font-mono">
                      <GitCommitHorizontal className="h-3 w-3" />
                      {commitDisplay}
                    </span>
                  ) : null}
                  {delivery.runId ? (
                    <Link
                      to={`/app/runs/${delivery.runId}`}
                      className="inline-flex items-center gap-1 text-accent-400 hover:text-accent-300"
                      onClick={onClose}
                    >
                      <ExternalLink className="h-3 w-3" />
                      View run
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
};
