import type { ReactNode } from "react";

import { useForm } from "@tanstack/react-form";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AppointmentDialogProps {
  defaultTitle?: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (title: string) => Promise<void> | void;
  open: boolean;
  title: string;
}

interface AppointmentDialogState {
  defaultTitle?: string;
  description?: string;
  onSubmit: (title: string) => Promise<void> | void;
  title: string;
  type: "create" | "edit";
}

export function AppointmentDialog({
  defaultTitle = "",
  description,
  onOpenChange,
  onSubmit,
  open,
  title,
}: AppointmentDialogProps) {
  const form = useForm({
    defaultValues: {
      title: defaultTitle,
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value.title);
      onOpenChange(false);
    },
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && (
              <DialogDescription>{description}</DialogDescription>
            )}
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <form.Field
              name="title"
              validators={{
                onChange: ({ value }) =>
                  !value || value.trim().length === 0
                    ? "Titel ist erforderlich"
                    : undefined,
              }}
            >
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>Titel</Label>
                  <Input
                    autoFocus
                    id={field.name}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                    }}
                    placeholder="Termin-Titel eingeben..."
                    value={field.state.value}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <span className="text-sm text-destructive">
                      {field.state.meta.errors.join(", ")}
                    </span>
                  )}
                </div>
              )}
            </form.Field>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                onOpenChange(false);
              }}
              type="button"
              variant="outline"
            >
              Abbrechen
            </Button>
            <Button disabled={!form.state.canSubmit} type="submit">
              Speichern
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function useAppointmentDialog() {
  const [dialogState, setDialogState] = useState<AppointmentDialogState | null>(
    null,
  );

  const openDialog = (state: AppointmentDialogState) => {
    setDialogState(state);
  };

  const closeDialog = () => {
    setDialogState(null);
  };

  const DialogComponent = dialogState ? (
    <AppointmentDialog
      defaultTitle={dialogState.defaultTitle ?? ""}
      description={dialogState.description ?? ""}
      onOpenChange={(open) => {
        if (!open) {
          closeDialog();
        }
      }}
      onSubmit={dialogState.onSubmit}
      open={true}
      title={dialogState.title}
    />
  ) : null;

  return {
    closeDialog,
    Dialog: DialogComponent as ReactNode,
    openDialog,
  };
}
