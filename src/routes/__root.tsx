// src/routes/__root.tsx
import { ReactQueryDevtools } from "@tanstack/react-query-devtools/production";
import {
  Link, // This is TanStack Router's Link
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import * as React from "react";
import type { QueryClient } from "@tanstack/react-query";
import appCss from "src/styles/app.css?url";
import { seo } from "src/utils/seo"; // Make sure this is uncommented
import { Toaster } from "sonner";

// Icons and UI components for the HomePage content
import { Calendar, Settings, Bug, Clock, FileText } from "lucide-react";
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
  head: () => {
    const seoData = seo({
      // Call seo and get the structured data
      title: "Praxis Terminverwaltung | Dynamisches Terminmanagement",
      description:
        "Dynamisches Terminmanagement mit regelbasierter Verfügbarkeit für Ihre Arztpraxis.",
      // Optionally add image: image: "/path/to/your/default-og-image.jpg",
      // Optionally add keywords: keywords: "Arzt, Termin, Praxis, Kalender, Management",
    });

    return {
      title: seoData.title, // Use the title from seoData
      meta: [
        {
          charSet: "utf-8",
        },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1",
        },
        ...seoData.metaTags, // Spread the generated meta tags
      ],
      links: [
        { rel: "stylesheet", href: appCss },
        {
          rel: "apple-touch-icon",
          sizes: "180x180",
          href: "/apple-touch-icon.png",
        },
        {
          rel: "icon",
          type: "image/png",
          sizes: "32x32",
          href: "/favicon-32x32.png",
        },
        {
          rel: "icon",
          type: "image/png",
          sizes: "16x16",
          href: "/favicon-16x16.png",
        },
        { rel: "manifest", href: "/site.webmanifest", color: "#ffffff" },
        { rel: "icon", href: "/favicon.ico" },
      ],
    };
  },
  errorComponent: (props: { error: any; reset: () => void }) => {
    return (
      <RootDocument>
        <div style={{ padding: "20px", textAlign: "center", color: "red" }}>
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
  notFoundComponent: () => (
    <RootDocument>
      <div style={{ padding: "20px", textAlign: "center" }}>
        <h1>404 - Seite nicht gefunden</h1>
        <p>Die gesuchte Seite existiert nicht.</p>
        <Link
          to="/"
          style={{ marginTop: "10px", display: "inline-block", color: "blue" }}
        >
          Zur Startseite
        </Link>
      </div>
    </RootDocument>
  ),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <ReactQueryDevtools />
        <TanStackRouterDevtools position="bottom-right" />
        <Toaster richColors position="top-right" />
        <Scripts />
      </body>
    </html>
  );
}

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
                Regelverwaltung
              </CardTitle>
              <CardDescription>
                Konfigurieren Sie Verfügbarkeitsregeln für Ihre Praxis
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Erstellen und verwalten Sie komplexe Regeln für die
                Terminvergabe
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/sim">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bug className="h-5 w-5" />
                Regelsimulation
              </CardTitle>
              <CardDescription>
                Testen Sie Ihre Regelkonfiguration
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Simulieren Sie Patientenszenarien und überprüfen Sie die
                Verfügbarkeit
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/woche">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Wochenansicht
              </CardTitle>
              <CardDescription>Wöchentlicher Terminkalender</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Übersicht über alle Termine der aktuellen Woche
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/monat">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Monatsansicht
              </CardTitle>
              <CardDescription>Monatlicher Terminkalender</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Übersicht über alle Termine des aktuellen Monats
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

        <Link to="/version">
          <Card className="hover:shadow-lg transition-shadow cursor-pointer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Versionen
              </CardTitle>
              <CardDescription>Regelversionen verwalten</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Überblick über alle Regelkonfigurationen und deren Historie
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
