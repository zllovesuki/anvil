import type { WebhookProvider, WebhookSummary } from "@/contracts";
import { useState } from "react";
import { RotateCw } from "lucide-react";
import { ConfirmDialog } from "@/client/components/ui";
import { SecretRevealDialog } from "@/client/components/webhooks/secret-reveal-dialog";
import { formatApiError, getApiClient } from "@/client/lib";
import { useAuth } from "@/client/auth";
import { useToast } from "@/client/toast";
import { webhookProviderCatalog } from "@/lib/webhooks";

interface RotateSecretDialogProps {
  open: boolean;
  onClose: () => void;
  webhook: WebhookSummary;
  webhookUrl: string;
  onRotated: () => void;
}

export const RotateSecretDialog = ({ open, onClose, webhook, webhookUrl, onRotated }: RotateSecretDialogProps) => {
  const { mode } = useAuth();
  const { pushToast } = useToast();
  const [rotating, setRotating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const catalog = webhookProviderCatalog[webhook.provider];

  const handleConfirm = () => {
    setRotating(true);

    void getApiClient(mode)
      .rotateWebhookSecret(webhook.projectId, webhook.provider)
      .then((response) => {
        setNewSecret(response.secret);
        onRotated();
        pushToast({
          tone: "success",
          title: "Secret rotated",
          message: `Update your ${catalog.displayName} webhook configuration.`,
        });
      })
      .catch((reason: unknown) => {
        pushToast({ tone: "error", title: "Rotation failed", message: formatApiError(reason) });
        onClose();
      })
      .finally(() => {
        setRotating(false);
      });
  };

  const handleClose = () => {
    setNewSecret(null);
    onClose();
  };

  if (newSecret) {
    return (
      <SecretRevealDialog
        open
        onClose={handleClose}
        secret={newSecret}
        provider={webhook.provider}
        webhookUrl={webhookUrl}
      />
    );
  }

  return (
    <ConfirmDialog
      open={open}
      onConfirm={handleConfirm}
      onCancel={onClose}
      title="Rotate webhook secret"
      description={`This will generate a new secret and invalidate the current one. You will need to update your ${catalog.displayName} webhook configuration immediately. This action cannot be undone.`}
      confirmLabel={rotating ? "Rotating..." : "Rotate Secret"}
      variant="warning"
      icon={<RotateCw className="h-5 w-5" />}
    />
  );
};
