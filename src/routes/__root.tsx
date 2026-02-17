// src/routes/__root.tsx
// react-scan must be imported before React and TanStack Start
import type { QueryClient } from "@tanstack/react-query";

import { TanStackDevtools } from "@tanstack/react-devtools";
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
import { CalendarPlus, Clock, Settings } from "lucide-react";

import { ModeToggle } from "@/components/mode-toggle";
import { ThemeProvider } from "@/components/theme-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"; // Ensure this path is correct

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
        <PostHogWrapper>
          <div className="min-h-screen">
            <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
              <ModeToggle />
            </div>
            <Outlet />
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
