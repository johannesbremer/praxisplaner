// src/routes/regeln.tsx - Redirect to new path parameter route
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/regeln")({
  beforeLoad: () => {
    // Redirect to the new route structure with no parameters (default state)
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      params: {
        // Omit all parameters to get default state
        // tab: undefined -> rule-management (default)
        // ruleSet: undefined -> active rule set
        // patientType: undefined -> new patient (default)
        // date: undefined -> today
      },
      to: "/regeln/{-$tab}/{-$ruleSet}/{-$patientType}/{-$date}",
    });
  },
});
