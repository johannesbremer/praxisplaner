// src/routes/regeln.{-$date}.{-$tab}.{-$location}.{-$ruleSet}.{-$patientType}.tsx
import { createFileRoute } from "@tanstack/react-router";

import LogicView from "./regeln";

export const Route = createFileRoute(
  "/regeln/{-$date}/{-$location}/{-$ruleSet}/{-$patientType}/{-$tab}",
)({
  component: LogicView,
});
