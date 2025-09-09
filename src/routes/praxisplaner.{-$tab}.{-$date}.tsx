// src/routes/praxisplaner.{-$tab}.{-$date}.tsx
import { createFileRoute } from "@tanstack/react-router";

import { PraxisPlanerComponent } from "./praxisplaner";

export const Route = createFileRoute("/praxisplaner/{-$tab}/{-$date}")({
  component: PraxisPlanerComponent,
});
