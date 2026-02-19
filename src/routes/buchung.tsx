// src/routes/buchung.tsx
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";

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
  component: BookingPage,
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

const APPOINTMENT_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "full",
  timeStyle: "short",
});

function formatAppointmentStart(start: string): string {
  try {
    const startEpochMilliseconds =
      Temporal.ZonedDateTime.from(start).epochMilliseconds;
    return APPOINTMENT_DATE_TIME_FORMATTER.format(startEpochMilliseconds);
  } catch {
    return start;
  }
}

/**
 * Main booking page component.
 * Handles authentication check before rendering the booking flow.
 */
function BookingPage() {
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
    // Start WorkOS sign-in as soon as WorkOS auth state is resolved and no user exists.
    // Do not block this on Convex loading, otherwise unauthenticated users can get stuck.
    if (authLoading || user) {
      return;
    }
    startSignIn();
  }, [authLoading, startSignIn, user]);

  // Authentication loading:
  // - always wait for WorkOS auth state
  // - wait for Convex only after WorkOS has a user
  if (authLoading || (user && convexLoading)) {
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
            <VisuallyHidden>
              <CardDescription>
                Bitte warten Sie einen Moment. Wir leiten Sie automatisch zur
                Anmeldung weiter.
              </CardDescription>
            </VisuallyHidden>
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
  const { signOut } = useAuth();
  const [sessionId, setSessionId] = useState<Id<"bookingSessions"> | null>(
    null,
  );
  const [isCancellingAppointment, setIsCancellingAppointment] = useState(false);
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
  const bookedAppointment = useQuery(
    api.appointments.getBookedAppointmentForCurrentUser,
    {},
  );

  // Mutations
  const cancelOwnAppointment = useMutation(
    api.appointments.cancelOwnAppointment,
  );
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
      bookedAppointment === null &&
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
    bookedAppointment,
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

  const handleSignOut = useCallback(() => {
    try {
      signOut();
    } catch (error) {
      console.error("Failed to sign out:", error);
      toast.error("Abmeldung fehlgeschlagen", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    }
  }, [signOut]);

  const handleCancelBookedAppointment = useCallback(async () => {
    if (!bookedAppointment || isCancellingAppointment) {
      return;
    }

    setIsCancellingAppointment(true);
    try {
      await cancelOwnAppointment({ appointmentId: bookedAppointment._id });

      if (resolvedSessionId) {
        try {
          await removeSession({ sessionId: resolvedSessionId });
        } catch (error) {
          console.error(
            "Failed to clear booking session after cancellation:",
            error,
          );
        }
      }

      setSessionId(null);
      toast.success("Termin wurde storniert");
    } catch (error) {
      console.error("Failed to cancel appointment:", error);
      toast.error("Termin konnte nicht storniert werden", {
        description:
          error instanceof Error
            ? error.message
            : "Bitte versuchen Sie es erneut.",
      });
    } finally {
      setIsCancellingAppointment(false);
    }
  }, [
    bookedAppointment,
    cancelOwnAppointment,
    isCancellingAppointment,
    removeSession,
    resolvedSessionId,
  ]);

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

  // Loading state for upcoming appointment lookup
  if (bookedAppointment === undefined) {
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

  if (bookedAppointment) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Sie haben bereits einen gebuchten Termin</CardTitle>
            <CardDescription>
              Ihr nächster Termin ist am{" "}
              {formatAppointmentStart(bookedAppointment.start)}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              disabled={isCancellingAppointment}
              onClick={() => void handleCancelBookedAppointment()}
              variant="destructive"
            >
              {isCancellingAppointment ? "Storniere..." : "Termin stornieren"}
            </Button>
            <Button
              className="w-full"
              onClick={handleSignOut}
              variant="outline"
            >
              Abmelden
            </Button>
          </CardContent>
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
            <div className="flex items-center gap-3">
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
              <Button onClick={handleSignOut} size="sm" variant="outline">
                Abmelden
              </Button>
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
    case "existing-calendar-selection":
    case "new-calendar-selection": {
      return <CalendarSelectionStep {...stepProps} />;
    }
    case "existing-confirmation":
    case "new-confirmation": {
      return <ConfirmationStep {...stepProps} />;
    }
    case "existing-data-input":
    case "existing-data-input-complete":
    case "new-data-input":
    case "new-data-input-complete": {
      return <DataInputStep {...stepProps} />;
    }
    case "existing-doctor-selection": {
      return <DoctorSelectionStep {...stepProps} />;
    }
    case "location": {
      return <LocationStep {...stepProps} />;
    }
    case "new-gkv-details":
    case "new-gkv-details-complete": {
      return <GkvDetailsStep {...stepProps} />;
    }
    case "new-insurance-type": {
      return <InsuranceTypeStep {...stepProps} />;
    }
    case "new-pkv-details":
    case "new-pkv-details-complete": {
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
