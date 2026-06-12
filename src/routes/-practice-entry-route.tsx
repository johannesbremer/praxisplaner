import { useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { type ReactElement, useEffect } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import { AuthenticatedGate } from "../auth/access-control";

export type PracticeEntryTarget = "booking" | "praxisplaner" | "regeln";

export function PracticeEntryRoute({
  target,
}: {
  target: PracticeEntryTarget;
}): ReactElement {
  return (
    <AuthenticatedGate>
      <PracticeEntryRedirect target={target} />
    </AuthenticatedGate>
  );
}

function PracticeEntryRedirect({
  target,
}: {
  target: PracticeEntryTarget;
}): ReactElement {
  const convexAuth = useConvexAuth();
  const navigate = useNavigate();
  const accessiblePractices = useQuery(
    api.practices.getAllPractices,
    convexAuth.isAuthenticated && target !== "booking" ? {} : "skip",
  );
  const bookingPractices = useQuery(
    api.practices.getBookingPractices,
    convexAuth.isAuthenticated && target === "booking" ? {} : "skip",
  );
  const practices =
    target === "booking" ? bookingPractices : accessiblePractices;
  const organizationSlug = practices?.[0]?.slug;

  useEffect(() => {
    if (!organizationSlug) {
      return;
    }

    if (target === "booking") {
      void navigate({
        params: { organizationSlug },
        replace: true,
        to: "/$organizationSlug",
      });
      return;
    }

    if (target === "praxisplaner") {
      void navigate({
        params: { organizationSlug },
        replace: true,
        to: "/$organizationSlug/praxisplaner",
      });
      return;
    }

    void navigate({
      params: { organizationSlug },
      replace: true,
      to: "/$organizationSlug/regeln",
    });
  }, [navigate, organizationSlug, target]);

  useEffect(() => {
    if (practices === undefined || practices.length > 0) {
      return;
    }

    void navigate({ replace: true, to: "/account" });
  }, [navigate, practices]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-96">
        <CardContent className="py-6">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Praxis wird geladen...</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
