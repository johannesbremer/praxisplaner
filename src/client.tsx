/// <reference types="vinxi/types/client" />
import { hydrateRoot } from "react-dom/client";
import { StartClient } from "@tanstack/react-start";
import { createRouter } from "./router";

// It's good practice to ensure the router is created before it's used.
// Depending on how Vinxi calls this default export,
// the router might need to be accessible or part of the export.
// For now, let's keep it simple.

function initializeClerkPWA() {
  const router = createRouter();
  hydrateRoot(document, <StartClient router={router} />);
}

export default initializeClerkPWA;
