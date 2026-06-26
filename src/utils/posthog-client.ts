import type { PostHog, PostHogConfig, Properties } from "posthog-js";

import posthog from "posthog-js";

import { RESERVED_TOP_LEVEL_ROUTE_SEGMENTS } from "@/lib/reserved-top-level-route-segments";

export const POSTHOG_PROXY_PATH = "/fluss";

interface AuthUserForPostHog {
  email?: null | string | undefined;
  firstName?: null | string | undefined;
  id: string;
  lastName?: null | string | undefined;
}

const pendingExceptions: {
  context: Properties | undefined;
  error: Error;
}[] = [];

const RESERVED_TOP_LEVEL_ROUTE_SEGMENT_SET: ReadonlySet<string> = new Set(
  RESERVED_TOP_LEVEL_ROUTE_SEGMENTS,
);

let registeredPostHogClient: null | PostHog = null;
let initializedPostHogClient: null | PostHog = null;

interface PostHogCaptureClient {
  captureException: PostHog["captureException"];
}

export function capturePostHogException(
  error: Error,
  context: Properties | undefined,
) {
  const posthog =
    registeredPostHogClient ??
    initializedPostHogClient ??
    initializePostHogClientIfEnabled() ??
    getGlobalPostHogClient();
  if (!posthog) {
    if (!canQueuePostHogException()) {
      return false;
    }

    pendingExceptions.push({ context, error });
    return false;
  }

  posthog.captureException(error, context);
  return true;
}

export function getPostHogApiKey() {
  return import.meta.env["VITE_PUBLIC_POSTHOG_KEY"] as string | undefined;
}

export function getPostHogHost() {
  return import.meta.env["VITE_PUBLIC_POSTHOG_HOST"] as string | undefined;
}

export function getPostHogProviderOptions(): Partial<PostHogConfig> {
  const postHogHost = getPostHogHost();
  return {
    api_host: POSTHOG_PROXY_PATH,
    capture_exceptions: true,
    defaults: "2026-05-30",
    disable_session_recording: isBookingRoutePathname(getCurrentPathname()),
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: "*",
    },
    ...(postHogHost ? { ui_host: getPostHogUiHost(postHogHost) } : {}),
  };
}

export function identifyPostHogUser(
  posthog: PostHog,
  user: AuthUserForPostHog,
) {
  posthog.identify(user.id, buildPostHogUserProperties(user));
}

export function initializePostHogClient(apiKey: string) {
  if (initializedPostHogClient) {
    return initializedPostHogClient;
  }

  initializedPostHogClient = posthog.init(apiKey, getPostHogProviderOptions());
  return initializedPostHogClient;
}

export function initializePostHogClientIfEnabled() {
  const apiKey = getPostHogApiKey();
  if (!apiKey || !isPostHogEnabled()) {
    return null;
  }

  return initializePostHogClient(apiKey);
}

export function isBookingRoutePathname(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const [segment] = segments;
  return (
    segments.length === 1 &&
    segment !== undefined &&
    !RESERVED_TOP_LEVEL_ROUTE_SEGMENT_SET.has(segment)
  );
}

export function isPostHogEnabled() {
  return (
    !import.meta.env.SSR &&
    Boolean(getPostHogApiKey()) &&
    Boolean(getPostHogHost()) &&
    (!import.meta.env.DEV ||
      Boolean(import.meta.env["VITE_ENABLE_POSTHOG_IN_DEV"]))
  );
}

export function registerPostHogClient(posthog: PostHog) {
  registeredPostHogClient = posthog;
  globalThis.posthog = posthog;

  while (pendingExceptions.length > 0) {
    const pendingException = pendingExceptions.shift();
    if (!pendingException) {
      continue;
    }
    posthog.captureException(pendingException.error, pendingException.context);
  }
}

export function resetPostHogIdentity(posthog?: PostHog) {
  const targetPostHog =
    posthog ?? registeredPostHogClient ?? initializedPostHogClient;
  targetPostHog?.reset();
}

export function stopPostHogSessionReplayForBookingRoute() {
  if (import.meta.env.SSR) {
    return;
  }

  const posthog = registeredPostHogClient ?? initializedPostHogClient;
  posthog?.stopSessionRecording();
}

export function unregisterPostHogClient(posthog: PostHog) {
  if (registeredPostHogClient === posthog) {
    registeredPostHogClient = null;
  }
  if (globalThis.posthog === posthog) {
    globalThis.posthog = undefined;
  }
}

function buildPostHogUserProperties(user: AuthUserForPostHog): Properties {
  return {
    ...(user.email ? { email: user.email } : {}),
    ...(user.firstName ? { first_name: user.firstName } : {}),
    ...(user.lastName ? { last_name: user.lastName } : {}),
  };
}

function canQueuePostHogException() {
  return !import.meta.env.SSR && isPostHogEnabled();
}

function getCurrentPathname() {
  if (import.meta.env.SSR) {
    return "/";
  }
  return globalThis.location.pathname;
}

function getGlobalPostHogClient(): null | PostHogCaptureClient {
  const candidate = globalThis.posthog;
  if (isPostHogCaptureClient(candidate)) {
    return candidate;
  }

  return null;
}

function getPostHogUiHost(postHogHost: string) {
  const postHogUrl = new URL(postHogHost);
  if (postHogUrl.hostname.endsWith(".i.posthog.com")) {
    postHogUrl.hostname = postHogUrl.hostname.replace(
      ".i.posthog.com",
      ".posthog.com",
    );
  }
  return postHogUrl.toString();
}

function isPostHogCaptureClient(
  candidate: unknown,
): candidate is PostHogCaptureClient {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    "captureException" in candidate &&
    typeof candidate.captureException === "function"
  );
}

declare global {
  var posthog: unknown;
}
