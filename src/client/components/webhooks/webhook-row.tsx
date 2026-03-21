import type { WebhookSummary } from "@/contracts";
import { useState, useEffect, useRef } from "react";
import { History, MoreVertical, Power, RotateCw, Trash2 } from "lucide-react";
import { Badge, Button } from "@/client/components/ui";
import { getWebhookProviderIcon } from "@/client/components/webhooks/webhook-presentation";
import { webhookProviderCatalog } from "@/lib/webhooks";

interface WebhookRowProps {
  webhook: WebhookSummary;
  webhookUrl: string;
  onToggle: () => void;
  onViewDeliveries: () => void;
  onRotateSecret: () => void;
  onDelete: () => void;
  toggling: boolean;
}

export const WebhookRow = ({
  webhook,
  webhookUrl,
  onToggle,
  onViewDeliveries,
  onRotateSecret,
  onDelete,
  toggling,
}: WebhookRowProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [menuOpen]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-3 py-2">
      {/* Left */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {getWebhookProviderIcon(webhook.provider)}
        <span className="text-sm font-medium text-zinc-200">
          {webhookProviderCatalog[webhook.provider].displayName}
        </span>
        <Badge variant={webhook.enabled ? "success" : "default"}>{webhook.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>

      {/* Right */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={toggling}
          onClick={onToggle}
          aria-label={webhook.enabled ? "Disable webhook" : "Enable webhook"}
        >
          <Power className="h-4 w-4" />
        </Button>

        <Button variant="ghost" size="sm" onClick={onViewDeliveries} aria-label="View deliveries">
          <History className="h-4 w-4" />
          {webhook.recentDeliveries.length > 0 && <span>{webhook.recentDeliveries.length}</span>}
        </Button>

        <div ref={menuRef} className="relative">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="true"
            aria-label="Webhook actions"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-1 min-w-max rounded-xl border border-zinc-700/60 bg-zinc-800 p-1 shadow-xl"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700/50"
                onClick={() => {
                  setMenuOpen(false);
                  onRotateSecret();
                }}
              >
                <RotateCw className="h-4 w-4" />
                Rotate secret
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-zinc-700/50"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete();
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete webhook
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
