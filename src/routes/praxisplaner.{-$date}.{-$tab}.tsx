// src/routes/praxisplaner.{-$date}.{-$tab}.tsx
import { createFileRoute } from "@tanstack/react-router";

import { PraxisPlanerComponent } from "./praxisplaner";

export const Route = createFileRoute("/praxisplaner/{-$date}/{-$tab}")({
  component: PraxisPlanerComponent,
});
