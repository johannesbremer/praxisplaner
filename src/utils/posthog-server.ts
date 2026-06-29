import "@tanstack/react-start/server-only";

import type { EventMessage } from "posthog-node";

import { PostHog } from "posthog-node";

let postHogClient: null | PostHog = null;

export async function capturePostHogServerEvent({
  distinctId,
  event,
  properties,
}: {
  distinctId: string;
  event: string;
  properties?: EventMessage["properties"] | undefined;
}) {
  const posthog = getPostHogServerClient();
  if (!posthog) {
    return;
  }

  await posthog.captureImmediate({
    distinctId,
    event,
    ...(properties ? { properties } : {}),
  });
}

export function getPostHogServerClient() {
  const apiKey = process.env["VITE_PUBLIC_POSTHOG_KEY"];
  const host = getPostHogServerHost();
  if (!apiKey || !host) {
    return null;
  }

  postHogClient ??= new PostHog(apiKey, {
    flushAt: 1,
    flushInterval: 0,
    host,
  });

  return postHogClient;
}

export function getPostHogServerHost() {
  return process.env["VITE_PUBLIC_POSTHOG_HOST"];
}
