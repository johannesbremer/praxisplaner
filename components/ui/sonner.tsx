import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";
import type { ToasterProps } from "sonner";

const Toaster = (props: ToasterProps) => {
  const { theme: nextSystemTheme } = useTheme();
  const sonnerTheme: NonNullable<ToasterProps["theme"]> =
    nextSystemTheme === "light" ||
    nextSystemTheme === "dark" ||
    nextSystemTheme === "system"
      ? nextSystemTheme
      : "system";

  return (
    <Sonner
      theme={sonnerTheme}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
