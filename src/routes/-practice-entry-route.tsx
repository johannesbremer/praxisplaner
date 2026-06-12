import { useNavigate } from "@tanstack/react-router";
import { useConvexAuth, useQuery } from "convex/react";
import { type ReactElement, useEffect } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";

import { AuthenticatedGate } from "../auth/access-control";

export type PracticeEntryTarget = "praxisplaner" | "regeln";

const PRACTICE_ENTRY_LOADING_TEXT = {
  praxisplaner: "Praxisplaner wird geöffnet...",
  regeln: "Regelverwaltung wird geöffnet...",
} satisfies Record<PracticeEntryTarget, string>;

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
    convexAuth.isAuthenticated ? {} : "skip",
  );
  const practices = accessiblePractices;
  const organizationSlug = practices?.[0]?.slug;

  useEffect(() => {
    if (!organizationSlug) {
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
            <Spinner />
            <span>{PRACTICE_ENTRY_LOADING_TEXT[target]}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
