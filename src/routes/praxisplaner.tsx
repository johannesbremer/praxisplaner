// src/routes/praxisplaner.tsx

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function PraxisPlanerRedirect() {
  // Redirect to the new parameterized route
  const navigate = useNavigate();
  
  useEffect(() => {
    void navigate({
      params: {
        date: undefined,
        tab: undefined,
      },
      to: "/praxisplaner/{-$date}/{-$tab}",
    });
  }, [navigate]);

  return null;
}

export const Route = createFileRoute("/praxisplaner")({
  component: PraxisPlanerRedirect,
});
