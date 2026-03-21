import { Check, Copy, Link2, UserPlus } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/client/auth";
import { Button, Dialog, ErrorBanner } from "@/client/components/ui";
import { formatApiError, getApiClient } from "@/client/lib";
import { useToast } from "@/client/toast";

interface InviteDialogProps {
  open: boolean;
  onClose(): void;
}

const formatInviteTtl = (seconds: number | null): string => {
  if (seconds === null) {
    return "the configured TTL";
  }

  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${seconds} second${seconds === 1 ? "" : "s"}`;
};

export const InviteDialog = ({ open, onClose }: InviteDialogProps) => {
  const { inviteTtlSeconds, mode } = useAuth();
  const { pushToast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inviteTtlLabel = formatInviteTtl(inviteTtlSeconds);

  const handleGenerate = () => {
    setGenerating(true);
    setError(null);

    void getApiClient(mode)
      .createInvite({})
      .then((response) => {
        const url = `${window.location.origin}/app/invite/accept?token=${encodeURIComponent(response.token)}`;
        setInviteToken(response.token);
        setInviteUrl(url);
        pushToast({
          tone: "success",
          title: "Invite created",
          message: `Expires ${new Date(response.expiresAt).toLocaleString()}.`,
        });
      })
      .catch((reason: unknown) => {
        const message = formatApiError(reason);
        setError(message);
        pushToast({ tone: "error", title: "Invite generation failed", message });
      })
      .finally(() => {
        setGenerating(false);
      });
  };

  const handleCopy = () => {
    if (!inviteUrl) {
      return;
    }

    void navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      pushToast({ tone: "info", title: "Copied", message: "Invite link copied to clipboard." });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleClose = () => {
    setInviteToken(null);
    setInviteUrl(null);
    setCopied(false);
    setError(null);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Invite a user"
      description="Generate a one-time invite link"
      icon={<UserPlus className="h-5 w-5" />}
    >
      {!inviteToken ? (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-zinc-400">
            Any registered operator can generate an invite link. The recipient uses it to create their account. Each
            invite token is single-use and expires after {inviteTtlLabel}.
          </p>

          {error ? <ErrorBanner message={error} /> : null}

          <Button
            variant="primary"
            className="w-full"
            disabled={generating}
            loading={generating}
            icon={!generating ? <Link2 className="h-4 w-4" /> : undefined}
            onClick={handleGenerate}
          >
            Generate Invite Link
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-zinc-400">
            Share this link with the person you want to invite. It can only be used once.
          </p>

          <div className="rounded-xl border border-zinc-700/60 bg-zinc-800/80 p-3">
            <p className="mb-2 text-xs uppercase tracking-[0.18em] text-zinc-500">Invite link</p>
            <p className="break-all font-mono text-sm text-accent-300">{inviteUrl}</p>
          </div>

          <div className="flex gap-3">
            <Button
              variant="primary"
              className="flex-1"
              icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              onClick={handleCopy}
            >
              {copied ? "Copied" : "Copy Link"}
            </Button>
            <Button variant="secondary" onClick={handleClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
