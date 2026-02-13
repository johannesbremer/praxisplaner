"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";

import { captureErrorGlobal } from "../utils/error-tracking";

interface BlockedSlotDeleteModalProps {
  blockedSlotId: Id<"blockedSlots">;
  blockedSlotTitle?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  runDeleteBlockedSlot?: (args: {
    id: Id<"blockedSlots">;
  }) => Promise<null | undefined>;
}

export function BlockedSlotDeleteModal({
  blockedSlotId,
  blockedSlotTitle,
  onOpenChange,
  open,
  runDeleteBlockedSlot: runDeleteBlockedSlotProp,
}: BlockedSlotDeleteModalProps) {
  const deleteBlockedSlotMutation = useMutation(
    api.appointments.deleteBlockedSlot,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  const runDeleteBlockedSlot =
    runDeleteBlockedSlotProp ??
    ((args: Parameters<typeof deleteBlockedSlotMutation>[0]) =>
      deleteBlockedSlotMutation(args));

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await runDeleteBlockedSlot({ id: blockedSlotId });
      toast.success("Sperrung erfolgreich gelöscht");
      onOpenChange(false);
    } catch (error: unknown) {
      captureErrorGlobal(error, {
        blockedSlotId,
        context: "blocked_slot_delete",
      });

      const description =
        error instanceof Error ? error.message : "Unbekannter Fehler";

      toast.error("Sperrung konnte nicht gelöscht werden", {
        description,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Sperrung löschen?</DialogTitle>
          <DialogDescription>
            {blockedSlotTitle
              ? `Möchten Sie "${blockedSlotTitle}" wirklich löschen?`
              : "Möchten Sie diesen gesperrten Zeitraum wirklich löschen?"}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            disabled={isDeleting}
            onClick={() => {
              onOpenChange(false);
            }}
            type="button"
            variant="outline"
          >
            Abbrechen
          </Button>
          <Button
            disabled={isDeleting}
            onClick={() => {
              void handleDelete();
            }}
            type="button"
            variant="destructive"
          >
            {isDeleting ? "Löschen..." : "Löschen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
