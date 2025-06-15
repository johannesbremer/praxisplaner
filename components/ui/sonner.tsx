import type { ToasterProps } from "sonner";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

const Toaster = (properties: ToasterProps) => {
  const { theme: nextSystemTheme } = useTheme();
  const sonnerTheme: NonNullable<ToasterProps["theme"]> =
    nextSystemTheme === "light" ||
    nextSystemTheme === "dark" ||
    nextSystemTheme === "system"
      ? nextSystemTheme
      : "system";

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
      {...properties}
    />
  );
};

export { Toaster };
