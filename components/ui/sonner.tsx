import type { ToasterProps } from "sonner";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

const sonnerThemes = new Map<string, NonNullable<ToasterProps["theme"]>>([
  ["dark", "dark"],
  ["light", "light"],
  ["system", "system"],
]);

const Toaster = (props: ToasterProps) => {
  const { theme: nextSystemTheme } = useTheme();
  const sonnerTheme: NonNullable<ToasterProps["theme"]> =
    nextSystemTheme === undefined
      ? "system"
      : (sonnerThemes.get(nextSystemTheme) ?? "system");

  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-border": "var(--border)",
          "--normal-text": "var(--popover-foreground)",
        } as React.CSSProperties
      }
      theme={sonnerTheme}
      {...props}
    />
  );
};

export { Toaster };
