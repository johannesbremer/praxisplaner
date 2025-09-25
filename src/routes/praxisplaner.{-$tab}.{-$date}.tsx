// src/routes/praxisplaner.{-$tab}.{-$date}.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

import {
  normalizePraxisplanerSearch,
  Route as PraxisplanerRoute,
  type PraxisplanerSearchParams,
} from "./praxisplaner";

export const Route = createFileRoute("/praxisplaner/{-$tab}/{-$date}")({
  beforeLoad: ({ params }) => {
    const nextSearch: PraxisplanerSearchParams = normalizePraxisplanerSearch({
      date: params.date,
      tab: params.tab,
    });

    redirect({
      replace: true,
      search: nextSearch,
      throw: true,
      to: PraxisplanerRoute.fullPath,
    });
  },
});
