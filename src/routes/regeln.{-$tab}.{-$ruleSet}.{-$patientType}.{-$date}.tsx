// src/routes/regeln.{-$tab}.{-$ruleSet}.{-$patientType}.{-$date}.tsx
import { createFileRoute } from "@tanstack/react-router";

import LogicView from "./regeln";

export const Route = createFileRoute(
  "/regeln/{-$tab}/{-$ruleSet}/{-$patientType}/{-$date}",
)({
  component: LogicView,
});
