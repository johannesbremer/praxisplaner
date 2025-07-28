// src/routes/regeln.tsx

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

function RegelnRedirect() {
  // Redirect to the new parameterized route
  const navigate = useNavigate();
  
  useEffect(() => {
    void navigate({
      params: {},  // Use empty object instead of explicit undefined values
      to: "/regeln/{-$tab}/{-$ruleSet}/{-$patientType}/{-$date}",
    });
  }, [navigate]);

  return null;
}

export const Route = createFileRoute("/regeln")({
  component: RegelnRedirect,
});