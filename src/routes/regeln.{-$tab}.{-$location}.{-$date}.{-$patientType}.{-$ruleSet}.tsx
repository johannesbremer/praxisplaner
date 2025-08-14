// src/routes/regeln.{-$tab}.{-$location}.{-$date}.{-$patientType}.{-$ruleSet}.tsx
import { createFileRoute } from "@tanstack/react-router";

import LogicView from "./regeln";

export const Route = createFileRoute(
  "/regeln/{-$tab}/{-$location}/{-$date}/{-$patientType}/{-$ruleSet}",
)({
  component: LogicView,
});
