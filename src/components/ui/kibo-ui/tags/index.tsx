"use client";

import { XIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type MouseEventHandler,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

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

interface TagsContextType {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  setValue?: ((value: string) => void) | undefined;
  setWidth?:
    | React.Dispatch<React.SetStateAction<number | undefined>>
    | undefined;
  value?: string | undefined;
  width?: number | undefined;
}

const TagsContext = createContext<TagsContextType | undefined>(undefined);

const useTagsContext = () => {
  const context = useContext(TagsContext);

  if (!context) {
    throw new Error("useTagsContext must be used within a TagsProvider");
  }

  return context;
};

export interface TagsProps {
  children?: ReactNode;
  className?: string;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  setValue?: (value: string) => void;
  value?: string;
}

export const Tags = ({
  children,
  className,
  onOpenChange: controlledOnOpenChange,
  open: controlledOpen,
  setValue,
  value,
}: TagsProps) => {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [width, setWidth] = useState<number>();
  const ref = useRef<HTMLDivElement>(null);

  const open = controlledOpen ?? uncontrolledOpen;
  const onOpenChange = controlledOnOpenChange ?? setUncontrolledOpen;

  useEffect(() => {
    if (!ref.current) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0]) {
        setWidth(entries[0].contentRect.width);
      }
    });

    resizeObserver.observe(ref.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <TagsContext.Provider
      value={{ onOpenChange, open, setValue, setWidth, value, width }}
    >
      <Popover onOpenChange={onOpenChange} open={open}>
        <div className={cn("relative w-full", className)} ref={ref}>
          {children}
        </div>
      </Popover>
    </TagsContext.Provider>
  );
};

export type TagsTriggerProps = ComponentProps<typeof Button>;

export const TagsTrigger = ({
  children,
  className,
  ...props
}: TagsTriggerProps) => (
  <PopoverTrigger asChild>
    <Button
      className={cn("h-auto w-full justify-between p-2", className)}
      // biome-ignore lint/a11y/useSemanticElements: "Required"
      role="combobox"
      variant="outline"
      {...props}
    >
      <div className="flex flex-wrap items-center gap-1">
        {children}
        <span className="px-2 py-px text-muted-foreground">
          Zusätzliche Ärztinnen auswählen...
        </span>
      </div>
    </Button>
  </PopoverTrigger>
);

export type TagsValueProps = ComponentProps<typeof Badge>;

export const TagsValue = ({
  children,
  className,
  onRemove,
  variant = "outline",
  ...props
}: TagsValueProps & { onRemove?: () => void }) => {
  const handleRemove: MouseEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRemove?.();
  };

  return (
    <Badge
      className={cn("flex items-center gap-2", className)}
      variant={variant}
      {...props}
    >
      {children}
      {onRemove && (
        // biome-ignore lint/a11y/noStaticElementInteractions: "This is a clickable badge"
        // biome-ignore lint/a11y/useKeyWithClickEvents: "This is a clickable badge"
        <div
          className="size-auto cursor-pointer hover:text-muted-foreground"
          onClick={handleRemove}
        >
          <XIcon size={12} />
        </div>
      )}
    </Badge>
  );
};

export type TagsContentProps = ComponentProps<typeof PopoverContent>;

export const TagsContent = ({
  children,
  className,
  ...props
}: TagsContentProps) => {
  const { width } = useTagsContext();

  return (
    <PopoverContent
      className={cn("p-0", className)}
      style={{ width }}
      {...props}
    >
      <Command>{children}</Command>
    </PopoverContent>
  );
};

export type TagsInputProps = ComponentProps<typeof CommandInput>;

export const TagsInput = ({ className, ...props }: TagsInputProps) => (
  <CommandInput className={cn("h-9", className)} {...props} />
);

export type TagsListProps = ComponentProps<typeof CommandList>;

export const TagsList = ({ className, ...props }: TagsListProps) => (
  <CommandList className={cn("max-h-[200px]", className)} {...props} />
);

export type TagsEmptyProps = ComponentProps<typeof CommandEmpty>;

export const TagsEmpty = ({ children, ...props }: TagsEmptyProps) => (
  <CommandEmpty {...props}>{children ?? "No tags found."}</CommandEmpty>
);

export type TagsGroupProps = ComponentProps<typeof CommandGroup>;

export type TagsItemProps = ComponentProps<typeof CommandItem>;

export const TagsItem = ({ className, ...props }: TagsItemProps) => (
  <CommandItem
    className={cn("cursor-pointer items-center justify-between", className)}
    {...props}
  />
);

export { CommandGroup as TagsGroup } from "@/components/ui/command";
