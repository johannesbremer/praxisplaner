// src/routes/praxisplaner.tsx - Redirect to new path parameter route
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/praxisplaner")({
  beforeLoad: () => {
    // Redirect to the new route structure with no parameters (default state)
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({
      params: {
        // Omit both parameters to get default state
      },
      to: "/praxisplaner/{-$date}/{-$tab}",
    });
  },
});
