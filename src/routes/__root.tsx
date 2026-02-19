// src/routes/__root.tsx
// react-scan must be imported before React and TanStack Start
import type { QueryClient } from "@tanstack/react-query";

import { TanStackDevtools } from "@tanstack/react-devtools";
import {
  formatForDisplay,
  formatKeyForDebuggingDisplay,
  formatWithLabels,
  normalizeHotkey,
  parseHotkey,
  useHotkey,
  validateHotkey,
} from "@tanstack/react-hotkeys";
import { hotkeysDevtoolsPlugin } from "@tanstack/react-hotkeys-devtools";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
  ClientOnly,
  createRootRouteWithContext,
  HeadContent,
  Link, // This is TanStack Router's Link
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { PostHogProvider } from "posthog-js/react";
import * as React from "react";
import { useEffect } from "react";
import { scan } from "react-scan";
import { Toaster } from "sonner";

import { CalendarDevtoolsPanel } from "../devtools/calendar-devtools-panel";
import appCss from "../styles/app.css?url";
import { captureErrorGlobal } from "../utils/error-tracking";
import { seo } from "../utils/seo"; // Make sure this is uncommented

// Client-only PostHog wrapper component
function PostHogWrapper({ children }: { children: React.ReactNode }) {
  const apiKey = import.meta.env["VITE_PUBLIC_POSTHOG_KEY"] as
    | string
    | undefined;
  const apiHost = import.meta.env["VITE_PUBLIC_POSTHOG_HOST"] as
    | string
    | undefined;

  // Disable PostHog in development unless explicitly enabled, or if not configured
  if (
    !apiKey ||
    (import.meta.env.DEV && !import.meta.env["VITE_ENABLE_POSTHOG_IN_DEV"])
  ) {
    return <>{children}</>;
  }

  const options = {
    ...(apiHost && { api_host: apiHost }),
  };

  return (
    <ClientOnly fallback={<>{children}</>}>
      <PostHogProvider apiKey={apiKey} options={options}>
        {children}
      </PostHogProvider>
    </ClientOnly>
  );
}

// Icons and UI components for the HomePage content
import { CalendarPlus, CircleHelp, Clock, Settings } from "lucide-react";

import { ModeToggle } from "@/components/mode-toggle";
import { ThemeProvider } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"; // Ensure this path is correct
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootComponent,
  errorComponent: (props: { error: Error; reset: () => void }) => {
    // Capture error with PostHog
    captureErrorGlobal(props.error, {
      context: "React Router error boundary",
      errorType: "router_error_boundary",
    });

    return (
      <RootDocument>
        <div style={{ color: "red", padding: "20px", textAlign: "center" }}>
          <h1>Etwas ist schiefgelaufen!</h1>
          <p>
            {props.error instanceof Error
              ? props.error.message
              : String(props.error)}
          </p>
          <button
            onClick={props.reset}
            style={{ marginTop: "10px", padding: "8px 16px" }}
          >
            Erneut versuchen
          </button>
        </div>
      </RootDocument>
    );
  },
  head: () => {
    const seoData = seo({
      // Call seo and get the structured data
      description:
        "Dynamisches Terminmanagement mit regelbasierter Verfügbarkeit für Ihre Arztpraxis.",
      title: "Praxis Terminverwaltung | Dynamisches Terminmanagement",
      // Optionally add image: image: "/path/to/your/default-og-image.jpg",
      // Optionally add keywords: keywords: "Arzt, Termin, Praxis, Kalender, Management",
    });

    return {
      links: [
        { href: appCss, rel: "stylesheet" },
        {
          href: "/apple-icon.png",
          rel: "apple-touch-icon",
          sizes: "180x180",
        },
        {
          href: "/favicon-32x32.png",
          rel: "icon",
          sizes: "32x32",
          type: "image/png",
        },
        {
          href: "/favicon-16x16.png",
          rel: "icon",
          sizes: "16x16",
          type: "image/png",
        },
        { href: "/manifest.json", rel: "manifest" },
        { href: "/favicon.ico", rel: "icon" },
      ],
      meta: [
        {
          charSet: "utf8",
        },
        {
          content: "width=device-width, initial-scale=1",
          name: "viewport",
        },
        ...seoData.metaTags, // Spread the generated meta tags
      ],
      title: seoData.title, // Use the title from seoData
    };
  },
  notFoundComponent: () => (
    <RootDocument>
      <div style={{ padding: "20px", textAlign: "center" }}>
        <h1>404 - Seite nicht gefunden</h1>
        <p>Die gesuchte Seite existiert nicht.</p>
        <Link
          style={{ color: "blue", display: "inline-block", marginTop: "10px" }}
          to="/"
        >
          Zur Startseite
        </Link>
      </div>
    </RootDocument>
  ),
});

export function PraxisplanerHomePageContent() {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Praxis Terminverwaltung</h1>
        <p className="text-muted-foreground">
          Dynamisches Terminmanagement mit regelbasierter Verfügbarkeit
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Link to="/regeln">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Regelverwaltung & Simulation
              </CardTitle>
              <CardDescription>
                Konfigurieren und testen Sie Verfügbarkeitsregeln
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Erstellen und verwalten Sie komplexe Regeln für die
                Terminvergabe und testen diese in der Simulation
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/praxisplaner">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                GDT File Processor
              </CardTitle>
              <CardDescription>GDT-Dateien verarbeiten</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                GDT-Dateien aus Verzeichnis einlesen und verarbeiten
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/buchung">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarPlus className="h-5 w-5" />
                Online-Terminbuchung
              </CardTitle>
              <CardDescription>Termine online buchen</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Patientenportal für die Online-Terminbuchung mit
                Anamnese-Fragebogen
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}

function RootComponent() {
  const [isHotkeysHelpOpen, setIsHotkeysHelpOpen] = React.useState(false);
  const parsedExample = parseHotkey("Mod+Shift+S");
  const validationValid = validateHotkey("Alt+A");
  const validationInvalid = validateHotkey("InvalidKey+S");

  useHotkey(
    { key: "?" },
    (event) => {
      if (event.repeat) {
        return;
      }

      setIsHotkeysHelpOpen(true);
    },
    {
      conflictBehavior: "replace",
    },
  );

  return (
    <RootDocument>
      <ThemeProvider defaultTheme="system" storageKey="praxisplaner-theme">
        <PostHogWrapper>
          <div className="min-h-screen">
            <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
              <Button
                aria-label="Hotkeys Hilfe öffnen"
                onClick={() => {
                  setIsHotkeysHelpOpen(true);
                }}
                size="icon"
                variant="outline"
              >
                <CircleHelp className="h-4 w-4" />
              </Button>
              <ModeToggle />
            </div>
            <Outlet />

            <Dialog
              onOpenChange={setIsHotkeysHelpOpen}
              open={isHotkeysHelpOpen}
            >
              <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Hotkeys Hilfe</DialogTitle>
                  <DialogDescription>
                    Kurzbefehle und Darstellung mit TanStack Hotkeys.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6 text-sm">
                  <section className="space-y-2">
                    <h3 className="font-semibold">Kurzbefehle in dieser App</h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <span>Rückgängig</span>
                        <ShortcutBadge hotkey="Mod+Z" />
                      </div>
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <span>Wiederholen</span>
                        <ShortcutBadge hotkey="Mod+Shift+Z" />
                      </div>
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <span>Wiederholen (Alt.)</span>
                        <ShortcutBadge hotkey="Mod+Y" />
                      </div>
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <span>Hilfe öffnen</span>
                        <ShortcutBadge hotkey="?" />
                      </div>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="font-semibold">formatForDisplay</h3>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <span>Mod+S</span>
                        <ShortcutBadge hotkey="Mod+S" />
                      </div>
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <span>Mod+Shift+Z</span>
                        <ShortcutBadge hotkey="Mod+Shift+Z" />
                      </div>
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <span>Control+Alt+D</span>
                        <ShortcutBadge hotkey="Control+Alt+D" />
                      </div>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="font-semibold">Labels und Debugging</h3>
                    <div className="rounded-md border p-3">
                      <div>
                        <strong>formatWithLabels(Mod+S):</strong>{" "}
                        {formatWithLabels("Mod+S")}
                      </div>
                      <div>
                        <strong>formatWithLabels(Mod+Shift+Z):</strong>{" "}
                        {formatWithLabels("Mod+Shift+Z")}
                      </div>
                    </div>
                    <div className="rounded-md border p-3">
                      <div>
                        <strong>formatKeyForDebuggingDisplay(Meta):</strong>{" "}
                        {formatKeyForDebuggingDisplay("Meta")}
                      </div>
                      <div>
                        <strong>formatKeyForDebuggingDisplay(Shift):</strong>{" "}
                        {formatKeyForDebuggingDisplay("Shift")}
                      </div>
                      <div>
                        <strong>formatKeyForDebuggingDisplay(Control):</strong>{" "}
                        {formatKeyForDebuggingDisplay("Control")}
                      </div>
                    </div>
                  </section>

                  <section className="space-y-2">
                    <h3 className="font-semibold">
                      Parsing, Normalisierung, Validation
                    </h3>
                    <div className="rounded-md border p-3 space-y-1">
                      <div>
                        <strong>parseHotkey(Mod+Shift+S)</strong>
                      </div>
                      <pre className="overflow-x-auto text-xs">
                        {JSON.stringify(parsedExample, null, 2)}
                      </pre>
                    </div>
                    <div className="rounded-md border p-3">
                      <div>
                        <strong>normalizeHotkey(Cmd+S):</strong>{" "}
                        {normalizeHotkey("Cmd+S")}
                      </div>
                      <div>
                        <strong>normalizeHotkey(Ctrl+Shift+s):</strong>{" "}
                        {normalizeHotkey("Ctrl+Shift+s")}
                      </div>
                      <div>
                        <strong>normalizeHotkey(Mod+S):</strong>{" "}
                        {normalizeHotkey("Mod+S")}
                      </div>
                    </div>
                    <div className="rounded-md border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <strong>validateHotkey(Alt+A)</strong>
                        <Badge
                          variant={
                            validationValid.valid ? "default" : "destructive"
                          }
                        >
                          {validationValid.valid ? "valid" : "invalid"}
                        </Badge>
                      </div>
                      {validationValid.warnings.map((warning) => (
                        <div className="text-muted-foreground" key={warning}>
                          {warning}
                        </div>
                      ))}
                      <div className="flex items-center gap-2 pt-2">
                        <strong>validateHotkey(InvalidKey+S)</strong>
                        <Badge
                          variant={
                            validationInvalid.valid ? "default" : "destructive"
                          }
                        >
                          {validationInvalid.valid ? "valid" : "invalid"}
                        </Badge>
                      </div>
                      {validationInvalid.errors.map((error) => (
                        <div className="text-destructive" key={error}>
                          {error}
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </PostHogWrapper>
      </ThemeProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Make sure to run this only after hydration
    scan({
      enabled: true,
    });
  }, []);

  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <ClientOnly fallback={null}>
          <TanStackDevtools
            eventBusConfig={{ debug: false }}
            plugins={[
              hotkeysDevtoolsPlugin(),
              {
                name: "TanStack Query",
                render: <ReactQueryDevtoolsPanel />,
              },
              {
                name: "TanStack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
              ...(import.meta.env.DEV
                ? [
                    {
                      name: "Calendar Diagnostics",
                      render: <CalendarDevtoolsPanel />,
                    },
                  ]
                : []),
            ]}
          />
        </ClientOnly>
        <Toaster position="top-right" richColors />
        <Scripts />
      </body>
    </html>
  );
}

function ShortcutBadge({ hotkey }: { hotkey: string }) {
  return (
    <kbd className="inline-flex min-w-16 items-center justify-center rounded-md border px-2 py-1 text-xs font-medium">
      {formatForDisplay(hotkey)}
    </kbd>
  );
}
