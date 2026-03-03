// src/routes/__root.tsx
import type { QueryClient } from "@tanstack/react-query";

import { formatForDisplay, useHotkey } from "@tanstack/react-hotkeys";
import {
  ClientOnly,
  createRootRouteWithContext,
  HeadContent,
  Link, // This is TanStack Router's Link
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { PostHogProvider } from "posthog-js/react";
import * as React from "react";
import { useEffect } from "react";
import { Toaster } from "sonner";

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
import { CalendarPlus, Clock, Redo2, Settings, Undo2 } from "lucide-react";

import { ModeToggle } from "@/components/mode-toggle";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"; // Ensure this path is correct

import {
  UndoRedoControlsProvider,
  useGlobalUndoRedoControls,
} from "../hooks/use-global-undo-redo-controls";

const LazyAppDevtools = __ENABLE_DEVTOOLS__
  ? React.lazy(() => import("../devtools/app-devtools"))
  : null;

const initializeReactScan = __ENABLE_DEVTOOLS__
  ? async () => {
      const { scan } = await import("react-scan");
      scan({
        dangerouslyForceRunInProduction: !import.meta.env.DEV,
        enabled: true,
        showToolbar: true,
      });
    }
  : null;

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
  return (
    <RootDocument>
      <ThemeProvider defaultTheme="system" storageKey="praxisplaner-theme">
        <UndoRedoControlsProvider>
          <PostHogWrapper>
            <RootLayout />
          </PostHogWrapper>
        </UndoRedoControlsProvider>
      </ThemeProvider>
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!initializeReactScan) {
      return;
    }

    void initializeReactScan().catch((error: unknown) => {
      captureErrorGlobal(error, {
        context: "React Scan initialization",
        errorType: "devtools_initialization",
      });
    });
  }, []);

  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        {LazyAppDevtools ? (
          <ClientOnly fallback={null}>
            <React.Suspense fallback={null}>
              <LazyAppDevtools />
            </React.Suspense>
          </ClientOnly>
        ) : null}
        <Toaster offset={72} position="top-right" richColors />
        <Scripts />
      </body>
    </html>
  );
}

function RootLayout() {
  const controls = useGlobalUndoRedoControls();
  const canUndo = controls?.canUndo ?? false;
  const canRedo = controls?.canRedo ?? false;
  const isHistoryOperationRunningRef = React.useRef(false);
  const handledHistoryHotkeySymbol = React.useMemo(
    () => Symbol("handled-history-hotkey"),
    [],
  );

  const alreadyHandledThisKeyEvent = React.useCallback(
    (event: KeyboardEvent) => {
      const marker = event as KeyboardEvent &
        Record<symbol, boolean | undefined>;
      if (marker[handledHistoryHotkeySymbol]) {
        return true;
      }

      marker[handledHistoryHotkeySymbol] = true;
      return false;
    },
    [handledHistoryHotkeySymbol],
  );

  const runHistoryAction = React.useCallback(
    (action: "redo" | "undo") => {
      if (!controls || isHistoryOperationRunningRef.current) {
        return;
      }

      isHistoryOperationRunningRef.current = true;

      let result: Promise<void> | void;
      try {
        result = action === "undo" ? controls.onUndo() : controls.onRedo();
      } catch {
        isHistoryOperationRunningRef.current = false;
        return;
      }

      void Promise.resolve(result).finally(() => {
        isHistoryOperationRunningRef.current = false;
      });
    },
    [controls],
  );

  useHotkey(
    "Mod+Z",
    (event) => {
      if (event.repeat || alreadyHandledThisKeyEvent(event)) {
        return;
      }
      runHistoryAction("undo");
    },
    {
      conflictBehavior: "replace",
      enabled: !!controls,
    },
  );

  useHotkey(
    "Mod+Shift+Z",
    (event) => {
      if (event.repeat || alreadyHandledThisKeyEvent(event)) {
        return;
      }
      runHistoryAction("redo");
    },
    {
      conflictBehavior: "replace",
      enabled: !!controls,
    },
  );

  useHotkey(
    "Mod+Y",
    (event) => {
      if (event.repeat || alreadyHandledThisKeyEvent(event)) {
        return;
      }
      runHistoryAction("redo");
    },
    {
      conflictBehavior: "replace",
      enabled: !!controls,
    },
  );

  React.useEffect(() => {
    if (!controls) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      const key = event.key.toLowerCase();
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.shiftKey || key !== "y") {
        return;
      }
      if (alreadyHandledThisKeyEvent(event)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      runHistoryAction("redo");
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [alreadyHandledThisKeyEvent, controls, runHistoryAction]);

  return (
    <div className="min-h-screen">
      <div className="fixed bottom-4 right-4 z-[60] flex items-center gap-2">
        {controls ? (
          <>
            <Button
              disabled={!canUndo}
              onClick={() => {
                runHistoryAction("undo");
              }}
              size="sm"
              variant="outline"
            >
              <Undo2 className="h-4 w-4" />
              <span className="ml-2 mr-1">Undo</span>
              <kbd className="rounded border px-1 py-0.5 text-[10px] leading-none">
                {formatForDisplay("Mod+Z")}
              </kbd>
            </Button>
            <Button
              disabled={!canRedo}
              onClick={() => {
                runHistoryAction("redo");
              }}
              size="sm"
              variant="outline"
            >
              <Redo2 className="h-4 w-4" />
              <span className="ml-2 mr-1">Redo</span>
              <kbd className="rounded border px-1 py-0.5 text-[10px] leading-none">
                {formatForDisplay("Mod+Y")}
              </kbd>
            </Button>
          </>
        ) : null}
        <ModeToggle />
      </div>
      <Outlet />
    </div>
  );
}
