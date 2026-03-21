import { useState } from "react";
import { Check, Copy, ExternalLink, Webhook } from "lucide-react";
import type { WebhookProvider } from "@/contracts";
import { Badge, Button, Dialog, ErrorBanner, Input } from "@/client/components/ui";
import { formatApiError, getApiClient } from "@/client/lib";
import { useAuth } from "@/client/auth";
import { useToast } from "@/client/toast";
import { inferWebhookInstanceUrl, webhookProviderCatalog, webhookProviderCatalogList } from "@/lib/webhooks";
import { getRecommendedProvider, getWebhookProviderIcon } from "@/client/components/webhooks/webhook-presentation";

interface AddWebhookDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  project: { ownerSlug: string; projectSlug: string; repoUrl: string };
  configuredProviders: WebhookProvider[];
  onCreated: (provider: WebhookProvider, generatedSecret: string | null, webhookUrl: string) => void;
}

export const AddWebhookDialog = ({
  open,
  onClose,
  projectId,
  project,
  configuredProviders,
  onCreated,
}: AddWebhookDialogProps) => {
  const { mode } = useAuth();
  const { pushToast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [selectedProvider, setSelectedProvider] = useState<WebhookProvider | null>(null);
  const [instanceUrl, setInstanceUrl] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const handleClose = () => {
    setStep(1);
    setSelectedProvider(null);
    setInstanceUrl("");
    setCreating(false);
    setError(null);
    setCopiedUrl(false);
    onClose();
  };

  const recommended = getRecommendedProvider(project.repoUrl);
  const catalog = selectedProvider ? webhookProviderCatalog[selectedProvider] : null;

  const webhookUrl = selectedProvider
    ? `${window.location.origin}/api/public/hooks/${selectedProvider}/${project.ownerSlug}/${project.projectSlug}`
    : "";

  const handleSelectProvider = (provider: WebhookProvider) => {
    if (configuredProviders.includes(provider)) return;
    setSelectedProvider(provider);
    const entry = webhookProviderCatalog[provider];
    setInstanceUrl(
      entry.configMode === "forbidden"
        ? ""
        : inferWebhookInstanceUrl(provider, project.repoUrl) || entry.defaultInstanceUrl || "",
    );
    setStep(2);
  };

  const handleCopyUrl = () => {
    void navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopiedUrl(true);
      pushToast({ tone: "success", title: "Copied", message: "Webhook URL copied to clipboard." });
      setTimeout(() => setCopiedUrl(false), 2000);
    });
  };

  const handleCreate = () => {
    if (!selectedProvider) return;

    const entry = webhookProviderCatalog[selectedProvider];
    const trimmedInstanceUrl = instanceUrl.trim();
    if (entry.configMode === "required" && trimmedInstanceUrl.length === 0) {
      setError(`${entry.displayName} webhooks require an instance URL.`);
      return;
    }

    setCreating(true);
    setError(null);

    const config =
      entry.configMode === "forbidden"
        ? undefined
        : trimmedInstanceUrl.length > 0
          ? { instanceUrl: trimmedInstanceUrl }
          : null;

    void getApiClient(mode)
      .createWebhook(projectId, selectedProvider, {
        enabled: true,
        ...(config === undefined ? {} : { config }),
      })
      .then((response) => {
        onCreated(selectedProvider, response.generatedSecret, webhookUrl);
        handleClose();
      })
      .catch((reason: unknown) => {
        setError(formatApiError(reason));
      })
      .finally(() => {
        setCreating(false);
      });
  };

  const handleBack = () => {
    setStep(1);
    setSelectedProvider(null);
    setInstanceUrl("");
    setError(null);
    setCopiedUrl(false);
  };

  if (step === 2 && catalog && selectedProvider) {
    const instanceUrlRequired = catalog.configMode === "required";

    return (
      <Dialog
        open={open}
        onClose={handleClose}
        title={`Configure ${catalog.displayName} Webhook`}
        icon={getWebhookProviderIcon(selectedProvider)}
      >
        <div className="space-y-5">
          {catalog.configMode !== "forbidden" ? (
            <Input
              label="Instance URL"
              helperText={`The base URL of your ${catalog.displayName} instance.${instanceUrlRequired ? " This field is required." : ""}`}
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              placeholder={catalog.defaultInstanceUrl ?? "https://example.com"}
              required={instanceUrlRequired}
            />
          ) : null}

          <div>
            <div className="flex items-center gap-2">
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Webhook URL</p>
              <button
                type="button"
                className="mb-2 rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
                onClick={handleCopyUrl}
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/80 p-3">
              <p className="break-all font-mono text-sm text-accent-300">{webhookUrl}</p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Setup Instructions</p>
            <ol className="list-inside list-decimal space-y-1 text-sm text-zinc-400">
              {catalog.setupInstructions.map((instruction) => (
                <li key={instruction}>{instruction}</li>
              ))}
            </ol>
          </div>

          <a
            href={catalog.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-accent-400 hover:text-accent-300"
          >
            Provider documentation <ExternalLink className="h-3 w-3" />
          </a>

          {error ? <ErrorBanner message={error} /> : null}

          <div className="flex items-center justify-end gap-3">
            <Button variant="secondary" onClick={handleBack}>
              Back
            </Button>
            <Button
              variant="primary"
              loading={creating}
              disabled={catalog.configMode === "required" && instanceUrl.trim().length === 0}
              onClick={handleCreate}
            >
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Add Webhook"
      description="Choose a webhook provider"
      icon={<Webhook className="h-5 w-5" />}
    >
      <div className="space-y-3">
        {webhookProviderCatalogList.map((entry) => {
          const isConfigured = configuredProviders.includes(entry.provider);
          const isRecommended = entry.provider === recommended;

          return (
            <button
              key={entry.provider}
              type="button"
              disabled={isConfigured}
              onClick={() => handleSelectProvider(entry.provider)}
              className={[
                "w-full rounded-xl border p-4 text-left transition-colors",
                isConfigured
                  ? "cursor-not-allowed opacity-50"
                  : isRecommended
                    ? "border-accent-500/30 bg-accent-500/5"
                    : "border-zinc-800/60 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-800/50",
              ].join(" ")}
            >
              <div className="flex items-center gap-2">
                {getWebhookProviderIcon(entry.provider)}
                <span className="text-sm font-medium text-zinc-200">{entry.displayName}</span>
                {isRecommended ? <Badge variant="accent">Recommended</Badge> : null}
                {isConfigured ? <Badge>Configured</Badge> : null}
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">
                {entry.verificationKind === "hmac-sha256" ? "HMAC-SHA256" : "Shared Secret"}
              </p>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
};
