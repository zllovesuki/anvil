import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Key } from "lucide-react";
import { Button, Dialog } from "@/client/components/ui";
import { useToast } from "@/client/toast";
import type { WebhookProvider } from "@/contracts";
import { webhookProviderCatalog } from "@/lib/webhooks";

interface SecretRevealDialogProps {
  open: boolean;
  onClose: () => void;
  secret: string;
  provider: WebhookProvider;
  webhookUrl: string;
}

export const SecretRevealDialog = ({ open, onClose, secret, provider, webhookUrl }: SecretRevealDialogProps) => {
  const { pushToast } = useToast();
  const [secondsRemaining, setSecondsRemaining] = useState(5);
  const [copied, setCopied] = useState(false);

  const catalog = webhookProviderCatalog[provider];

  useEffect(() => {
    if (!open) {
      return;
    }

    setSecondsRemaining(5);

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [open]);

  const handleCopySecret = () => {
    void navigator.clipboard.writeText(secret).then(() => {
      setCopied(true);
      pushToast({ tone: "info", title: "Copied", message: "Webhook secret copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Webhook Secret"
      description={`${catalog.displayName} webhook configuration`}
      icon={<Key className="h-5 w-5" />}
      dismissDisabled={secondsRemaining > 0}
    >
      <div className="space-y-4">
        <p className="text-sm text-amber-400">
          This secret is shown only once. Copy it now and paste it into your {catalog.displayName} webhook settings.
        </p>

        <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/80 p-3">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Secret</p>
          <p className="break-all font-mono text-sm text-accent-300">{secret}</p>
        </div>

        <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/80 p-3">
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Webhook URL</p>
          <p className="break-all font-mono text-sm text-accent-300">{webhookUrl}</p>
        </div>

        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Setup instructions</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-zinc-400">
            {catalog.setupInstructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <a
            href={catalog.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-accent-300 transition-colors hover:text-accent-200"
          >
            View {catalog.displayName} docs
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="flex gap-3">
          <Button
            variant="primary"
            className="flex-1"
            icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            onClick={handleCopySecret}
          >
            {copied ? "Copied" : "Copy Secret"}
          </Button>
          {secondsRemaining > 0 ? (
            <Button variant="secondary" disabled>
              Wait {secondsRemaining}s...
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
};
