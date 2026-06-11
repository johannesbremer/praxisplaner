import { createFileRoute } from "@tanstack/react-router";

import { PracticeEntryRoute } from "./-practice-entry-route";

export const Route = createFileRoute("/buchung")({
  component: BuchungEntryRoute,
});

function BuchungEntryRoute() {
  return <PracticeEntryRoute target="booking" />;
}
