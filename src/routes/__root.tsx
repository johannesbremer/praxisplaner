// __root.tsx
import { ReactQueryDevtools } from "@tanstack/react-query-devtools/production";
import {
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
  HeadContent,
  Scripts,
  // ErrorComponentProps, // You might import this for more specific error prop typing
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import * as React from "react";
import { Toaster } from "react-hot-toast";
import type { QueryClient } from "@tanstack/react-query";
// import { DefaultCatchBoundary } from "~/components/DefaultCatchBoundary"; // Removed: Component not found
// import { IconLink } from "~/components/IconLink"; // Removed: Component not found
// import { NotFound } from "~/components/NotFound"; // Removed: Component not found
import appCss from "~/styles/app.css?url";
import { seo } from "~/utils/seo";
// import { Loader } from "~/components/Loader"; // Removed: Component not found

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      ...seo({
        title:
          "TanStack Start | Type-Safe, Client-First, Full-Stack React Framework",
        description: `TanStack Start is a type-safe, client-first, full-stack React framework. `,
      }),
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
      { rel: "manifest", href: "/site.webmanifest", color: "#fffff" },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  // Replaced DefaultCatchBoundary with an inline error component
  errorComponent: (props: { error: any; reset: () => void }) => {
    // You can use ErrorComponentProps from @tanstack/react-router for better typing if desired
    return (
      <RootDocument>
        <div style={{ padding: "20px", textAlign: "center", color: "red" }}>
          <h1>Something went wrong!</h1>
          <p>
            {props.error instanceof Error
              ? props.error.message
              : String(props.error)}
          </p>
          <button
            onClick={props.reset}
            style={{ marginTop: "10px", padding: "8px 16px" }}
          >
            Try Again
          </button>
        </div>
      </RootDocument>
    );
  },
  // Replaced NotFound component with an inline version
  notFoundComponent: () => (
    <RootDocument>
      <div style={{ padding: "20px", textAlign: "center" }}>
        <h1>404 - Page Not Found</h1>
        <p>The page you are looking for does not exist.</p>
        <Link
          to="/"
          style={{ marginTop: "10px", display: "inline-block", color: "blue" }}
        >
          Go Home
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
        <div className="h-screen flex flex-col min-h-0">
          <div className="bg-slate-900 border-b border-slate-800 flex items-center justify-between py-4 px-8 box-border">
            <div className="flex items-center gap-4">
              <div>
                <Link to="/" className="block leading-tight">
                  <div className="font-black text-2xl text-white">Trellaux</div>
                  <div className="text-slate-500">a TanStack Demo</div>
                </Link>
              </div>
              <LoadingIndicator />
            </div>
            <div className="flex items-center gap-6">
              {/* IconLink components were removed/commented out due to missing component */}
              {/* You can uncomment these when IconLink is available */}
              {/*
              <IconLink
                href="https://github.com/TanStack/router/tree/main/examples/react/start-trellaux"
                label="Source"
                icon="/github-mark-white.png"
              />
              <IconLink
                href="https://tanstack.com"
                icon="/tanstack.png"
                label="TanStack"
              />
              */}
              {/* Fallback simple links: */}
              <a
                href="https://github.com/TanStack/router/tree/main/examples/react/start-trellaux"
                className="text-white hover:text-slate-300"
              >
                Source
              </a>
              <a
                href="https://tanstack.com"
                className="text-white hover:text-slate-300"
              >
                TanStack
              </a>
            </div>
          </div>

          <div className="flex-grow min-h-0 h-full flex flex-col">
            {children}
            <Toaster />
          </div>
        </div>
        <ReactQueryDevtools />
        <TanStackRouterDevtools position="bottom-right" />
        <Scripts />
      </body>
    </html>
  );
}

function LoadingIndicator() {
  const isLoading = useRouterState({ select: (s) => s.isLoading });
  return (
    <div
      className={`h-12 transition-all duration-300 flex items-center ${
        isLoading ? `opacity-100 delay-300` : `opacity-0 delay-0`
      }`}
    >
      {/* Loader component was removed/commented out due to missing component */}
      {/* You can uncomment this when Loader is available */}
      {/* <Loader /> */}
      {isLoading && <div className="text-white">Loading...</div>}{" "}
      {/* Placeholder for Loader */}
    </div>
  );
}
