import { useQuery } from "convex/react";
import { useCallback, useEffect, useRef } from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

interface AppointmentTypeSelectorProps {
  disableAutoDeselect?: boolean | undefined;
  isBlockingModeActive?: boolean | undefined;
  onBlockingModeChange?: ((active: boolean) => void) | undefined;
  onTypeDeselect?: (() => void) | undefined;
  onTypeSelect: (type: Id<"appointmentTypes">) => void;
  ruleSetId: Id<"ruleSets">;
  selectedType: Id<"appointmentTypes"> | undefined;
  showBlockingMode?: boolean | undefined;
}

export function AppointmentTypeSelector({
  disableAutoDeselect = false,
  isBlockingModeActive = false,
  onBlockingModeChange,
  onTypeDeselect,
  onTypeSelect,
  ruleSetId,
  selectedType,
  showBlockingMode = true,
}: AppointmentTypeSelectorProps) {
  const appointmentTypesQuery = useQuery(api.entities.getAppointmentTypes, {
    ruleSetId,
  });

  const appointmentTypes = appointmentTypesQuery ?? [];
  const cardRef = useRef<HTMLDivElement>(null);

  // Check if anything is selected (appointment type or blocking mode)
  const hasSelection = selectedType !== undefined || isBlockingModeActive;

  // Handle deselection
  const handleDeselect = useCallback(() => {
    if (selectedType !== undefined && onTypeDeselect) {
      onTypeDeselect();
    }
    if (isBlockingModeActive && onBlockingModeChange) {
      onBlockingModeChange(false);
    }
  }, [
    selectedType,
    isBlockingModeActive,
    onTypeDeselect,
    onBlockingModeChange,
  ]);

  // Handle ESC key to deselect
  useEffect(() => {
    if (disableAutoDeselect || !hasSelection) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleDeselect();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [disableAutoDeselect, hasSelection, handleDeselect]);

  // Handle click outside to deselect
  useEffect(() => {
    if (disableAutoDeselect || !hasSelection) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;

      // Don't deselect if clicking inside the card
      if (cardRef.current?.contains(target)) {
        return;
      }

      // Don't deselect if clicking inside a dialog/modal (rendered in a portal)
      // Check for Radix Dialog elements using data-slot attribute or role="dialog"
      const targetElement = target as HTMLElement;
      if (
        targetElement.closest(
          '[data-slot="dialog-content"], [data-slot="dialog-overlay"], [role="dialog"], [data-radix-portal]',
        )
      ) {
        return;
      }

      handleDeselect();
    };

    // Use a small delay to avoid conflicts with button clicks
    const timeoutId = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [disableAutoDeselect, hasSelection, handleDeselect]);

  return (
    <Card className="gap-4 border-border bg-card" ref={cardRef}>
      <CardHeader className="px-4">
        <CardTitle className="text-base">Terminart wählen</CardTitle>
      </CardHeader>
      <CardContent className="px-4">
        {appointmentTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Keine Terminarten verfügbar
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {appointmentTypes.map((appointmentType) => {
              const isSelected = selectedType === appointmentType._id;
              return (
                <Button
                  className={
                    isSelected
                      ? "h-auto justify-start p-3 text-left"
                      : "h-auto justify-start border-border bg-popover p-3 text-left text-foreground hover:bg-secondary hover:text-secondary-foreground"
                  }
                  key={appointmentType._id}
                  onClick={() => {
                    if (isSelected) {
                      // Toggle off if already selected
                      if (onTypeDeselect) {
                        onTypeDeselect();
                      }
                    } else {
                      // Deactivate blocking mode when selecting an appointment type
                      if (isBlockingModeActive && onBlockingModeChange) {
                        onBlockingModeChange(false);
                      }
                      onTypeSelect(appointmentType._id);
                    }
                  }}
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                >
                  {appointmentType.name}
                </Button>
              );
            })}
            {/* Block Slot Button */}
            {showBlockingMode && onBlockingModeChange && (
              <Button
                className={
                  isBlockingModeActive
                    ? "h-auto justify-start p-3 text-left"
                    : "h-auto justify-start border-border bg-popover p-3 text-left text-foreground hover:bg-destructive-muted hover:text-destructive"
                }
                onClick={() => {
                  if (isBlockingModeActive) {
                    // Toggle off if already active
                    onBlockingModeChange(false);
                  } else {
                    // Deselect appointment type when activating blocking mode
                    if (selectedType !== undefined && onTypeDeselect) {
                      onTypeDeselect();
                    }
                    onBlockingModeChange(true);
                  }
                }}
                size="sm"
                variant={isBlockingModeActive ? "destructive" : "outline"}
              >
                Sperren
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
