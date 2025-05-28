// src/routes/index.tsx
import { createFileRoute } from "@tanstack/react-router";
// Import the HomePage component from __root.tsx
import { PraxisplanerHomePageContent } from "./__root";

export const Route = createFileRoute("/")({
  component: PraxisplanerHomePageContent,
});
