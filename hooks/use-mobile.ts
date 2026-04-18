import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;
const unsubscribeNoop = () => 0;

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMobileQuery,
    getMobileSnapshot,
    getServerMobileSnapshot,
  );
}

function getMobileSnapshot() {
  return (
    typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia(MOBILE_MEDIA_QUERY).matches
  );
}

function getServerMobileSnapshot() {
  return false;
}

function subscribeToMobileQuery(onStoreChange: () => void) {
  if (typeof globalThis.matchMedia !== "function") {
    return unsubscribeNoop;
  }

  const mediaQuery = globalThis.matchMedia(MOBILE_MEDIA_QUERY);
  mediaQuery.addEventListener("change", onStoreChange);
  return () => {
    mediaQuery.removeEventListener("change", onStoreChange);
  };
}
