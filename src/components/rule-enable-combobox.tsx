"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

interface RuleEnableComboboxProps {
  disabled?: boolean;
  onNeedRuleSet?: () => void;
  onRuleEnabled?: () => void;
  practiceId: Id<"practices">;
  ruleSetId?: Id<"ruleSets">;
}

export function RuleEnableCombobox({
  disabled = false,
  onNeedRuleSet,
  onRuleEnabled,
  practiceId,
  ruleSetId,
}: RuleEnableComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState("");
  const [searchTerm, setSearchTerm] = React.useState("");

  const availableRulesQuery = useQuery(
    api.rules.getAvailableRulesForRuleSet,
    ruleSetId
      ? {
          practiceId,
          ruleSetId,
          ...(searchTerm.trim() && { searchTerm: searchTerm.trim() }),
        }
      : "skip",
  );

  const enableRuleMutation = useMutation(api.rules.enableRuleInRuleSet);

  const handleSelect = async (ruleId: string) => {
    if (!ruleSetId) {
      onNeedRuleSet?.();
      return;
    }

    try {
      // For now, use a default priority of 100. We can improve this later
      await enableRuleMutation({
        priority: 100,
        ruleId: ruleId as Id<"rules">,
        ruleSetId,
      });

      toast.success("Regel aktiviert", {
        description: "Die Regel wurde erfolgreich zum Regelset hinzugefügt.",
      });

      setValue("");
      setOpen(false);
      onRuleEnabled?.();
    } catch (error) {
      toast.error("Fehler beim Aktivieren der Regel", {
        description:
          error instanceof Error ? error.message : "Unbekannter Fehler",
      });
    }
  };

  const handleButtonClick = () => {
    if (!ruleSetId) {
      onNeedRuleSet?.();
      return;
    }

    // Check if there are any rules available to enable
    const hasAvailableRules = availableRules.length > 0;
    if (!hasAvailableRules) {
      toast.info("Keine Regeln verfügbar", {
        description: "Es gibt keine weiteren Regeln, die zu diesem Regelset hinzugefügt werden können.",
      });
      return;
    }

    setOpen(!open);
  };

  const availableRules = availableRulesQuery ?? [];
  const hasAvailableRules = availableRules.length > 0;

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          className="w-[250px] justify-between"
          disabled={disabled || !ruleSetId || !hasAvailableRules}
          onClick={handleButtonClick}
          role="combobox"
          variant="outline"
        >
          {value
            ? availableRules.find((rule) => rule._id === value)?.name
            : ruleSetId
              ? hasAvailableRules
                ? "Regel hinzufügen..."
                : "Keine Regeln verfügbar"
              : "Wählen Sie erst ein Regelset"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0">
        <Command>
          <CommandInput
            onValueChange={setSearchTerm}
            placeholder="Regel suchen..."
            value={searchTerm}
          />
          <CommandList>
            <CommandEmpty>Keine verfügbaren Regeln gefunden.</CommandEmpty>
            <CommandGroup>
              {availableRules.map((rule) => (
                <CommandItem
                  key={rule._id}
                  onSelect={() => {
                    void handleSelect(rule._id);
                  }}
                  value={rule._id}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === rule._id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex flex-col">
                    <span className="font-medium">{rule.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {rule.description}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
