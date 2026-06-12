import { createFileRoute } from "@tanstack/react-router";

import { PracticeEntryRoute } from "./-practice-entry-route";

export const Route = createFileRoute("/regeln")({
  component: RegelnEntryRoute,
});

function RegelnEntryRoute() {
  return <PracticeEntryRoute target="regeln" />;
}
