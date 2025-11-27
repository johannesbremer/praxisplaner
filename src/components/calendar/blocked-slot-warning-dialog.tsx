import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
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
  /**
   * Whether the user can book over this blocked slot.
   * If false, only the reason and cancel button are shown.
   * If true, the "Trotzdem buchen" button is shown.
   */
  canBook: boolean;
  isManualBlock?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  reason?: string;
  slotTime: string;
}

export function BlockedSlotWarningDialog({
  canBook,
  isManualBlock = false,
  onCancel,
  onConfirm,
  open,
  reason,
  slotTime,
}: BlockedSlotWarningDialogProps) {
  // Use reason as title if available, otherwise fall back to generic title
  const title = reason || "Zeitfenster ist blockiert";

  // Adjust description based on whether booking is possible
  const description = canBook
    ? reason
      ? "Möchten Sie dennoch einen Termin zu dieser Zeit erstellen?"
      : `Der gewählte Zeitfenster um ${slotTime} Uhr ist ${isManualBlock ? "manuell blockiert" : "durch Regeln blockiert"}. Möchten Sie dennoch einen Termin zu dieser Zeit erstellen?`
    : undefined;

  return (
    <Dialog onOpenChange={onCancel} open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <VisuallyHidden>
              <DialogDescription>
                Dieses Zeitfenster ist blockiert.
              </DialogDescription>
            </VisuallyHidden>
          )}
        </DialogHeader>

        <DialogFooter>
          {canBook && (
            <Button onClick={onConfirm} variant="outline">
              Trotzdem buchen
            </Button>
          )}
          <Button autoFocus onClick={onCancel} variant="default">
            Abbrechen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
