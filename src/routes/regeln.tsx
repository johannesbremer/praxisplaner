// src/routes/regeln.tsx

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function RegelnRedirect() {
  // Redirect to the new parameterized route
  const navigate = useNavigate();
  
  useEffect(() => {
    void navigate({
      to: "/regeln/{-$tab}/{-$ruleSet}/{-$patientType}/{-$date}",
      params: {
        tab: undefined,
        ruleSet: undefined,
        patientType: undefined,
        date: undefined,
      },
    });
  }, [navigate]);

  return null;
}

export const Route = createFileRoute("/regeln")({
  component: RegelnRedirect,
});