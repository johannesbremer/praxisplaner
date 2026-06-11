// src/routes/praxisplaner.{-$tab}.{-$date}.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";

import {
  normalizePraxisplanerSearch,
  type PraxisplanerSearchParams,
} from "../utils/praxisplaner-search";
import { Route as PraxisplanerRoute } from "./praxisplaner";

export const Route = createFileRoute("/praxisplaner/{-$tab}/{-$date}")({
  beforeLoad: ({ params }) => {
    // Only redirect if there are actual path params present.
    // Without this check, visiting /praxisplaner would match this route
    // (since the params are optional) and cause an infinite redirect loop.
    if (!params.tab && !params.date) {
      return;
    }

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
