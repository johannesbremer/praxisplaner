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
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  reason?: string;
  slotTime: string;
}

export function BlockedSlotWarningDialog({
  onCancel,
  onConfirm,
  open,
  reason,
  slotTime,
}: BlockedSlotWarningDialogProps) {
  return (
    <Dialog onOpenChange={onCancel} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Zeitfenster ist blockiert
          </DialogTitle>
          <DialogDescription>
            Der gewählte Zeitfenster um {slotTime} Uhr ist durch Regeln
            blockiert.
            {reason && (
              <>
                <br />
                <br />
                <strong>Grund:</strong> {reason}
              </>
            )}
            <br />
            <br />
            Möchten Sie dennoch einen Termin zu dieser Zeit erstellen?
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            Abbrechen
          </Button>
          <Button onClick={onConfirm} variant="default">
            Termin trotzdem erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
