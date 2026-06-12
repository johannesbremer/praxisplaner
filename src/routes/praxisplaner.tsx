import { createFileRoute } from "@tanstack/react-router";

import { PracticeEntryRoute } from "./-practice-entry-route";

export const Route = createFileRoute("/praxisplaner")({
  component: PraxisplanerEntryRoute,
});

function PraxisplanerEntryRoute() {
  return <PracticeEntryRoute target="praxisplaner" />;
}
