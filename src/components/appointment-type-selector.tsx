import { useQuery } from "convex/react";
import { useCallback, useEffect, useRef } from "react";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

interface AppointmentTypeSelectorProps {
  isBlockingModeActive?: boolean | undefined;
  onBlockingModeChange?: ((active: boolean) => void) | undefined;
  onTypeDeselect?: (() => void) | undefined;
  onTypeSelect: (type: Id<"appointmentTypes">) => void;
  ruleSetId: Id<"ruleSets">;
  selectedType: Id<"appointmentTypes"> | undefined;
}

export function AppointmentTypeSelector({
  isBlockingModeActive = false,
  onBlockingModeChange,
  onTypeDeselect,
  onTypeSelect,
  ruleSetId,
  selectedType,
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
    if (!hasSelection) {
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
  }, [hasSelection, handleDeselect]);

  // Handle click outside to deselect
  useEffect(() => {
    if (!hasSelection) {
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
  }, [hasSelection, handleDeselect]);

  return (
    <Card ref={cardRef}>
      <CardHeader>
        <CardTitle className="text-base">Terminart wählen</CardTitle>
      </CardHeader>
      <CardContent>
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
                  className="justify-start text-left h-auto p-3"
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
            {onBlockingModeChange && (
              <Button
                className="justify-start text-left h-auto p-3"
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
