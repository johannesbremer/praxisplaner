import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BlockedSlotWarningDialogProps {
  isManualBlock?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  reason?: string;
  slotTime: string;
}

export function BlockedSlotWarningDialog({
  isManualBlock = false,
  onCancel,
  onConfirm,
  open,
  reason,
  slotTime,
}: BlockedSlotWarningDialogProps) {
  // Use reason as title if available, otherwise fall back to generic title
  const title = reason || "Zeitfenster ist blockiert";
  const description = reason
    ? "Möchten Sie dennoch einen Termin zu dieser Zeit erstellen?"
    : `Der gewählte Zeitfenster um ${slotTime} Uhr ist ${isManualBlock ? "manuell blockiert" : "durch Regeln blockiert"}. Möchten Sie dennoch einen Termin zu dieser Zeit erstellen?`;

  return (
    <Dialog onOpenChange={onCancel} open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button onClick={onConfirm} variant="outline">
            Trotzdem buchen
          </Button>
          <Button autoFocus onClick={onCancel} variant="default">
            Abbrechen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
