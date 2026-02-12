// src/routes/buchung.tsx
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { Id } from "@/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/convex/_generated/api";

import {
  AgeCheckStep,
  AppointmentTypeStep,
  type BookingSessionState,
  CalendarSelectionStep,
  canGoBack,
  ConfirmationStep,
  DataInputStep,
  DoctorSelectionStep,
  getStepGroup,
  GkvDetailsStep,
  InsuranceTypeStep,
  LocationStep,
  PatientStatusStep,
  PkvDetailsStep,
  PrivacyStep,
  PvsConsentStep,
  type StepComponentProps,
} from "../components/booking-wizard/index";

export const Route = createFileRoute("/buchung")({
  component: PatientBookingPage,
});

// Step group labels for progress indicator
const STEP_GROUP_LABELS: Record<ReturnType<typeof getStepGroup>, string> = {
  booking: "Termin",
  confirmation: "Bestätigung",
  consent: "Einwilligung",
  info: "Angaben",
};

// Order of step groups
const STEP_GROUP_ORDER: ReturnType<typeof getStepGroup>[] = [
  "consent",
  "info",
  "booking",
  "confirmation",
];

/**
 * Main booking page component.
 * Handles authentication check before rendering the booking flow.
 */
function PatientBookingPage() {
  const { isLoading: authLoading, signIn, user } = useAuth();
  const { isAuthenticated: convexAuthenticated, isLoading: convexLoading } =
    useConvexAuth();
  const [signInError, setSignInError] = useState<null | string>(null);
  const signInRequestedRef = useRef(false);

  const startSignIn = useCallback(() => {
    if (signInRequestedRef.current) {
      return;
    }
    signInRequestedRef.current = true;
    signIn().catch((error: unknown) => {
      signInRequestedRef.current = false;
      setSignInError(
        error instanceof Error
          ? error.message
          : "Anmeldung konnte nicht gestartet werden",
      );
    });
  }, [signIn]);

  const handleRetrySignIn = useCallback(() => {
    setSignInError(null);
    startSignIn();
  }, [startSignIn]);

  useEffect(() => {
    if (authLoading || convexLoading || (user && convexAuthenticated)) {
      return;
    }
    startSignIn();
  }, [authLoading, convexAuthenticated, convexLoading, startSignIn, user]);

  // Authentication loading (either WorkOS or Convex)
  if (authLoading || convexLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-96">
          <CardContent className="py-6">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Laden...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Require authentication - redirect to sign-in automatically.
  if (!user || !convexAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Weiterleitung zur Anmeldung...</CardTitle>
            <CardDescription>
              Bitte warten Sie einen Moment. Wir leiten Sie automatisch zur
              Anmeldung weiter.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {signInError ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive">{signInError}</p>
                <Button
                  className="w-full"
                  onClick={() => {
                    handleRetrySignIn();
                  }}
                >
                  Erneut versuchen
                </Button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Anmeldung wird geöffnet...</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // User is authenticated, render the booking flow
  return <AuthenticatedBookingFlow />;
}

/**
 * Booking flow component that only renders after authentication.
 * This separation ensures Convex hooks are only called when the user is authenticated.
 */
function AuthenticatedBookingFlow() {
  const [sessionId, setSessionId] = useState<Id<"bookingSessions"> | null>(
    null,
  );
  const [sessionError, setSessionError] = useState<null | string>(null);
  const isCreatingSessionRef = useRef(false);

  // Fetch practice data
  const practicesQuery = useQuery(api.practices.getAllPractices, {});
  const currentPractice = practicesQuery?.[0];

  // Get active rule set for the practice
  const activeRuleSetId = currentPractice?.currentActiveRuleSetId;

  const existingSession = useQuery(
    api.bookingSessions.getActiveForUser,
    currentPractice && activeRuleSetId
      ? { practiceId: currentPractice._id, ruleSetId: activeRuleSetId }
      : "skip",
  );

  const resolvedSessionId = sessionId ?? existingSession?._id ?? null;

  // Query the session if we have one
  const session = useQuery(
    api.bookingSessions.get,
    resolvedSessionId ? { sessionId: resolvedSessionId } : "skip",
  );

  // Mutations
  const createSession = useMutation(api.bookingSessions.create);
  const removeSession = useMutation(api.bookingSessions.remove);
  const goBackMutation = useMutation(api.bookingSessions.goBack);

  // Create session on mount
  useEffect(() => {
    if (
      currentPractice &&
      activeRuleSetId &&
      !resolvedSessionId &&
      !isCreatingSessionRef.current &&
      !sessionError &&
      existingSession !== undefined &&
      !existingSession
    ) {
      isCreatingSessionRef.current = true;
      createSession({
        practiceId: currentPractice._id,
        ruleSetId: activeRuleSetId,
      })
        .then(setSessionId)
        .catch((error: unknown) => {
          console.error("Failed to create booking session:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Unbekannter Fehler";
          setSessionError(errorMessage);
          toast.error("Buchung konnte nicht gestartet werden", {
            description:
              "Bitte versuchen Sie es erneut oder kontaktieren Sie die Praxis.",
          });
        })
        .finally(() => {
          isCreatingSessionRef.current = false;
        });
    }
  }, [
    currentPractice,
    activeRuleSetId,
    sessionId,
    createSession,
    sessionError,
    existingSession,
    resolvedSessionId,
  ]);

  // Handle retry after session creation error
  const handleRetrySessionCreation = useCallback(() => {
    setSessionError(null);
  }, []);

  // Handle starting over
  const handleStartOver = useCallback(() => {
    if (resolvedSessionId) {
      void removeSession({ sessionId: resolvedSessionId });
    }
    setSessionId(null);
  }, [resolvedSessionId, removeSession]);

  // Handle back navigation using unified goBack mutation
  const handleBack = useCallback(async () => {
    if (!resolvedSessionId) {
      return;
    }

    try {
      await goBackMutation({ sessionId: resolvedSessionId });
    } catch (error) {
      console.error("Failed to go back:", error);
      toast.error("Navigation fehlgeschlagen", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    }
  }, [resolvedSessionId, goBackMutation]);

  // Loading state
  if (!practicesQuery) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-96">
          <CardContent className="py-6">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Laden...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No practice configured
  if (!currentPractice) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Praxis nicht gefunden</CardTitle>
            <CardDescription>
              Die Online-Terminbuchung ist derzeit nicht verfügbar. Bitte
              kontaktieren Sie die Praxis telefonisch.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // No active rule set
  if (!activeRuleSetId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Terminbuchung nicht verfügbar</CardTitle>
            <CardDescription>
              Die Online-Terminbuchung ist derzeit nicht konfiguriert. Bitte
              kontaktieren Sie die Praxis telefonisch.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Session creation error
  if (sessionError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Buchung konnte nicht gestartet werden</CardTitle>
            <CardDescription>
              Bei der Vorbereitung Ihrer Buchung ist ein Fehler aufgetreten.
              Bitte versuchen Sie es erneut oder kontaktieren Sie die Praxis
              telefonisch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={handleRetrySessionCreation}>
              Erneut versuchen
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Session loading
  if (!resolvedSessionId || session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-96">
          <CardContent className="py-6">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Buchung wird vorbereitet...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Session expired or not found
  if (session === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Sitzung abgelaufen</CardTitle>
            <CardDescription>
              Ihre Buchungssitzung ist abgelaufen. Bitte starten Sie den
              Buchungsvorgang erneut.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={handleStartOver}>
              Neu starten
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentGroup = getStepGroup(session.state.step);
  const showBackButton = canGoBack(session.state.step);

  // Prepare props for step components
  const stepProps: StepComponentProps = {
    practiceId: currentPractice._id,
    ruleSetId: activeRuleSetId,
    sessionId: resolvedSessionId,
    state: session.state,
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-background to-muted/20">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold">{currentPractice.name}</h1>
              <p className="text-sm text-muted-foreground">
                Online-Terminbuchung
              </p>
            </div>
            {/* Step group indicator */}
            <div className="flex items-center gap-2 text-sm">
              {STEP_GROUP_ORDER.map((group, index) => (
                <div className="flex items-center" key={group}>
                  {index > 0 && <div className="w-8 h-px bg-border mr-2" />}
                  <div
                    className={`flex items-center gap-1.5 ${
                      currentGroup === group
                        ? "text-primary font-medium"
                        : STEP_GROUP_ORDER.indexOf(group) <
                            STEP_GROUP_ORDER.indexOf(currentGroup)
                          ? "text-primary/60"
                          : "text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                        currentGroup === group
                          ? "border-primary bg-primary text-primary-foreground"
                          : STEP_GROUP_ORDER.indexOf(group) <
                              STEP_GROUP_ORDER.indexOf(currentGroup)
                            ? "border-primary/60 bg-primary/20"
                            : ""
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="hidden sm:inline">
                      {STEP_GROUP_LABELS[group]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Back button */}
        {showBackButton && (
          <div className="max-w-2xl mx-auto mb-6">
            <Button
              className="w-fit"
              onClick={() => void handleBack()}
              variant="ghost"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Zurück
            </Button>
          </div>
        )}

        {/* Step content */}
        <div className="max-w-2xl mx-auto">
          <StepRenderer
            onStartOver={handleStartOver}
            step={session.state.step}
            stepProps={stepProps}
          />
        </div>
      </main>
    </div>
  );
}

// Step renderer component
interface StepRendererProps {
  onStartOver: () => void;
  step: BookingSessionState["step"];
  stepProps: StepComponentProps;
}

function StepRenderer({ onStartOver, step, stepProps }: StepRendererProps) {
  switch (step) {
    case "existing-appointment-type":
    case "new-appointment-type": {
      return <AppointmentTypeStep {...stepProps} />;
    }
    case "existing-calendar-selection":
    case "new-calendar-selection": {
      return <CalendarSelectionStep {...stepProps} />;
    }
    case "existing-confirmation":
    case "new-confirmation": {
      return <ConfirmationStep {...stepProps} onStartOver={onStartOver} />;
    }
    case "existing-data-input":
    case "new-data-input": {
      return <DataInputStep {...stepProps} />;
    }
    case "existing-doctor-selection": {
      return <DoctorSelectionStep {...stepProps} />;
    }
    case "location": {
      return <LocationStep {...stepProps} />;
    }
    case "new-age-check": {
      return <AgeCheckStep {...stepProps} />;
    }
    case "new-gkv-details": {
      return <GkvDetailsStep {...stepProps} />;
    }
    case "new-insurance-type": {
      return <InsuranceTypeStep {...stepProps} />;
    }
    case "new-pkv-details": {
      return <PkvDetailsStep {...stepProps} />;
    }
    case "new-pvs-consent": {
      return <PvsConsentStep {...stepProps} />;
    }
    case "patient-status": {
      return <PatientStatusStep {...stepProps} />;
    }
    case "privacy": {
      return <PrivacyStep {...stepProps} />;
    }
    default: {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Unbekannter Schritt</CardTitle>
            <CardDescription>
              Ein Fehler ist aufgetreten. Bitte starten Sie den Buchungsvorgang
              erneut.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={onStartOver}>
              Neu starten
            </Button>
          </CardContent>
        </Card>
      );
    }
  }
}
