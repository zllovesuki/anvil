import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/client/components/ui/button";
import { Dialog } from "@/client/components/ui/dialog";

interface ConfirmDialogProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "danger" | "warning";
  icon?: ReactNode;
}

export const ConfirmDialog = ({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = "Confirm",
  variant = "danger",
  icon,
}: ConfirmDialogProps) => (
  <Dialog open={open} onClose={onCancel} title={title} icon={icon ?? <AlertTriangle className="h-5 w-5" />}>
    <div className="space-y-4">
      <p className="text-sm text-zinc-400">{description}</p>
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={variant === "danger" ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  </Dialog>
);
