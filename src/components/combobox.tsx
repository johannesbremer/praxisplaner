import { Check, ChevronsUpDown, X } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  label: string;
  value: string;
}

interface ComboboxProps {
  "aria-invalid"?: boolean | undefined;
  className?: string;
  inverted?: boolean;
  multiple?: boolean;
  onValueChange: (value: string | string[]) => void;
  options: ComboboxOption[];
  placeholder?: string;
  value: string | string[];
}

export function Combobox({
  "aria-invalid": ariaInvalid,
  className,
  inverted = false,
  multiple = false,
  onValueChange,
  options,
  placeholder = "Auswählen...",
  value,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);

  const selectedValues = Array.isArray(value) ? value : value ? [value] : [];

  const handleSelect = (currentValue: string) => {
    if (multiple) {
      const newValues = selectedValues.includes(currentValue)
        ? selectedValues.filter((v) => v !== currentValue)
        : [...selectedValues, currentValue];
      onValueChange(newValues);
    } else {
      onValueChange(currentValue === value ? "" : currentValue);
      setOpen(false);
    }
  };

  const handleRemove = (valueToRemove: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (multiple) {
      const newValues = selectedValues.filter((v) => v !== valueToRemove);
      onValueChange(newValues);
    }
  };

  const getDisplayText = () => {
    if (selectedValues.length === 0) {
      return placeholder;
    }

    if (multiple) {
      return (
        <div className="flex flex-wrap gap-1">
          {selectedValues.map((val) => {
            const option = options.find((opt) => opt.value === val);
            return (
              <Badge
                className="gap-1"
                key={val}
                variant={inverted ? "destructive" : "secondary"}
              >
                {option?.label || val}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={(e) => {
                    handleRemove(val, e);
                  }}
                />
              </Badge>
            );
          })}
        </div>
      );
    }

    const option = options.find((opt) => opt.value === selectedValues[0]);
    return option?.label || selectedValues[0];
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-invalid={ariaInvalid}
          className={cn(
            "justify-between w-auto",
            selectedValues.length === 0 && "text-muted-foreground",
            ariaInvalid && [
              "border-destructive",
              "dark:border-destructive",
              "ring-destructive/20",
              "dark:ring-destructive/40",
            ],
            className,
          )}
          role="combobox"
          variant="outline"
        >
          <span className="truncate">{getDisplayText()}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[200px] p-0">
        <Command>
          <CommandInput className="h-9" placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>Keine Optionen gefunden.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  onSelect={() => {
                    handleSelect(option.value);
                  }}
                  value={option.value}
                >
                  {option.label}
                  <Check
                    className={cn(
                      "ml-auto h-4 w-4",
                      selectedValues.includes(option.value)
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
