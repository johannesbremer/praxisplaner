// src/routes/buchung.tsx
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useHotkey } from "@tanstack/react-hotkeys";
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { getBookingSessionStepKind } from "@/lib/booking-session-steps";

import {
  BookedAppointmentsSummary,
  type BookingSessionState,
  CalendarSelectionStep,
  canGoBack,
  DataInputStep,
  DataSharingStep,
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
import {
  captureFrontendError,
  frontendErrorFromUnknown,
  invalidStateError,
  wrapAsyncResult,
} from "../utils/frontend-errors";

export const Route = createFileRoute("/buchung")({
  component: BookingPage,
});

// Step group labels for progress indicator
const STEP_GROUP_LABELS: Record<ReturnType<typeof getStepGroup>, string> = {
  booking: "Termin",
  consent: "Einwilligung",
  info: "Angaben",
};

// Order of step groups
const STEP_GROUP_ORDER: ReturnType<typeof getStepGroup>[] = [
  "consent",
  "info",
  "booking",
];

function buildDisplayedBookingState(
  baseState: BookingSessionState,
  overrideStep: BookingSessionState["step"] | null,
): BookingSessionState {
  if (overrideStep === null || overrideStep === baseState.step) {
    return baseState;
  }

  switch (overrideStep) {
    case "existing-calendar-selection":
    case "new-calendar-selection": {
      return baseState;
    }
    case "existing-data-input": {
      if (
        "locationLineageKey" in baseState &&
        "locationName" in baseState &&
        "practitionerLineageKey" in baseState &&
        "practitionerName" in baseState
      ) {
        return {
          isNewPatient: false,
          locationLineageKey: baseState.locationLineageKey,
          locationName: baseState.locationName,
          ...("personalData" in baseState
            ? { personalData: baseState.personalData }
            : {}),
          practitionerLineageKey: baseState.practitionerLineageKey,
          practitionerName: baseState.practitionerName,
          step: "existing-data-input",
        };
      }
      return baseState;
    }
    case "existing-doctor-selection": {
      return "locationLineageKey" in baseState && "locationName" in baseState
        ? {
            isNewPatient: false,
            locationLineageKey: baseState.locationLineageKey,
            locationName: baseState.locationName,
            step: "existing-doctor-selection",
          }
        : baseState;
    }
    case "location": {
      return { step: "location" };
    }
    case "new-data-input": {
      if (
        "locationLineageKey" in baseState &&
        "locationName" in baseState &&
        "insuranceType" in baseState
      ) {
        if (baseState.insuranceType === "gkv" && "hzvStatus" in baseState) {
          return {
            hzvStatus: baseState.hzvStatus,
            insuranceType: "gkv",
            isNewPatient: true,
            locationLineageKey: baseState.locationLineageKey,
            locationName: baseState.locationName,
            ...("medicalHistory" in baseState
              ? { medicalHistory: baseState.medicalHistory }
              : {}),
            ...("personalData" in baseState
              ? { personalData: baseState.personalData }
              : {}),
            step: "new-data-input",
          };
        }
        if (baseState.insuranceType === "pkv") {
          return {
            ...("beihilfeStatus" in baseState
              ? { beihilfeStatus: baseState.beihilfeStatus }
              : {}),
            insuranceType: "pkv",
            isNewPatient: true,
            locationLineageKey: baseState.locationLineageKey,
            locationName: baseState.locationName,
            ...("medicalHistory" in baseState
              ? { medicalHistory: baseState.medicalHistory }
              : {}),
            ...("personalData" in baseState
              ? { personalData: baseState.personalData }
              : {}),
            ...("pkvInsuranceType" in baseState
              ? { pkvInsuranceType: baseState.pkvInsuranceType }
              : {}),
            ...("pkvTariff" in baseState
              ? { pkvTariff: baseState.pkvTariff }
              : {}),
            pvsConsent: true,
            step: "new-data-input",
          };
        }
      }
      return baseState;
    }
    case "new-data-input-complete":
    case "new-gkv-details-complete":
    case "new-pkv-details-complete": {
      return baseState;
    }
    case "new-data-sharing": {
      if (
        "locationLineageKey" in baseState &&
        "locationName" in baseState &&
        "insuranceType" in baseState &&
        "personalData" in baseState
      ) {
        if (baseState.insuranceType === "gkv" && "hzvStatus" in baseState) {
          return {
            hzvStatus: baseState.hzvStatus,
            insuranceType: "gkv",
            isNewPatient: true,
            locationLineageKey: baseState.locationLineageKey,
            locationName: baseState.locationName,
            ...("medicalHistory" in baseState
              ? { medicalHistory: baseState.medicalHistory }
              : {}),
            personalData: baseState.personalData,
            step: "new-data-sharing",
          };
        }
        return {
          ...("beihilfeStatus" in baseState
            ? { beihilfeStatus: baseState.beihilfeStatus }
            : {}),
          insuranceType: "pkv",
          isNewPatient: true,
          locationLineageKey: baseState.locationLineageKey,
          locationName: baseState.locationName,
          ...("medicalHistory" in baseState
            ? { medicalHistory: baseState.medicalHistory }
            : {}),
          personalData: baseState.personalData,
          ...("pkvInsuranceType" in baseState
            ? { pkvInsuranceType: baseState.pkvInsuranceType }
            : {}),
          ...("pkvTariff" in baseState
            ? { pkvTariff: baseState.pkvTariff }
            : {}),
          pvsConsent: true,
          step: "new-data-sharing",
        };
      }
      return baseState;
    }
    case "new-gkv-details": {
      if (
        "locationLineageKey" in baseState &&
        "locationName" in baseState &&
        "insuranceType" in baseState &&
        baseState.insuranceType === "gkv"
      ) {
        return {
          ...("hzvStatus" in baseState
            ? { hzvStatus: baseState.hzvStatus }
            : {}),
          insuranceType: "gkv",
          isNewPatient: true,
          locationLineageKey: baseState.locationLineageKey,
          locationName: baseState.locationName,
          step: "new-gkv-details",
        };
      }
      return baseState;
    }
    case "new-insurance-type": {
      return "locationLineageKey" in baseState && "locationName" in baseState
        ? {
            isNewPatient: true,
            locationLineageKey: baseState.locationLineageKey,
            locationName: baseState.locationName,
            step: "new-insurance-type",
          }
        : baseState;
    }
    case "new-pkv-details": {
      if (
        "locationLineageKey" in baseState &&
        "locationName" in baseState &&
        "insuranceType" in baseState &&
        baseState.insuranceType === "pkv"
      ) {
        return {
          ...("beihilfeStatus" in baseState
            ? { beihilfeStatus: baseState.beihilfeStatus }
            : {}),
          insuranceType: "pkv",
          isNewPatient: true,
          locationLineageKey: baseState.locationLineageKey,
          locationName: baseState.locationName,
          ...("pkvInsuranceType" in baseState
            ? { pkvInsuranceType: baseState.pkvInsuranceType }
            : {}),
          ...("pkvTariff" in baseState
            ? { pkvTariff: baseState.pkvTariff }
            : {}),
          pvsConsent: true,
          step: "new-pkv-details",
        };
      }
      return baseState;
    }
    case "new-pvs-consent": {
      return "locationLineageKey" in baseState && "locationName" in baseState
        ? {
            insuranceType: "pkv",
            isNewPatient: true,
            locationLineageKey: baseState.locationLineageKey,
            locationName: baseState.locationName,
            step: "new-pvs-consent",
          }
        : baseState;
    }
    case "patient-status": {
      return "locationLineageKey" in baseState && "locationName" in baseState
        ? {
            locationLineageKey: baseState.locationLineageKey,
            locationName: baseState.locationName,
            step: "patient-status",
          }
        : baseState;
    }
    case "privacy": {
      return { step: "privacy" };
    }
  }
}

function getPreviousDisplayStep(
  state: BookingSessionState,
): BookingSessionState["step"] | null {
  switch (state.step) {
    case "existing-calendar-selection": {
      return "existing-data-input";
    }
    case "existing-data-input": {
      return "existing-doctor-selection";
    }
    case "existing-doctor-selection": {
      return "patient-status";
    }
    case "location": {
      return "privacy";
    }
    case "new-calendar-selection": {
      return "new-data-sharing";
    }
    case "new-data-input": {
      return state.insuranceType === "gkv"
        ? "new-gkv-details"
        : "new-pkv-details";
    }
    case "new-data-input-complete": {
      return "new-data-input";
    }
    case "new-data-sharing": {
      return "new-data-input";
    }
    case "new-gkv-details": {
      return "new-insurance-type";
    }
    case "new-gkv-details-complete": {
      return "new-gkv-details";
    }
    case "new-insurance-type": {
      return "patient-status";
    }
    case "new-pkv-details": {
      return "new-pvs-consent";
    }
    case "new-pkv-details-complete": {
      return "new-pkv-details";
    }
    case "new-pvs-consent": {
      return "new-insurance-type";
    }
    case "patient-status": {
      return "location";
    }
    case "privacy": {
      return null;
    }
  }
}

function isServerBackTargetStep(
  step: BookingSessionState["step"],
): step is Exclude<
  BookingSessionState["step"],
  | "existing-calendar-selection"
  | "new-calendar-selection"
  | "new-data-input-complete"
  | "new-gkv-details-complete"
  | "new-pkv-details-complete"
> {
  switch (step) {
    case "existing-calendar-selection":
    case "new-calendar-selection":
    case "new-data-input-complete":
    case "new-gkv-details-complete":
    case "new-pkv-details-complete": {
      return false;
    }
    case "existing-data-input":
    case "existing-doctor-selection":
    case "location":
    case "new-data-input":
    case "new-data-sharing":
    case "new-gkv-details":
    case "new-insurance-type":
    case "new-pkv-details":
    case "new-pvs-consent":
    case "patient-status":
    case "privacy": {
      return true;
    }
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
  const [bookedAppointmentRefreshNonce, setBookedAppointmentRefreshNonce] =
    useState(0);
  const [sessionError, setSessionError] = useState<null | string>(null);
  const [displayStepOverride, setDisplayStepOverride] = useState<
    BookingSessionState["step"] | null
  >(null);
  const isCreatingSessionRef = useRef(false);
  const stepContainerRef = useRef<HTMLDivElement>(null);
  const isInitializingPracticeRef = useRef(false);

  // Fetch practice data
  const practicesQuery = useQuery(api.practices.getAllPractices, {});
  const initializeDefaultPractice = useMutation(
    api.practices.initializeDefaultPractice,
  );
  const currentPractice = practicesQuery?.[0];

  // `/buchung` always follows the currently active rule set of the practice.
  const practiceActiveRuleSetId = currentPractice?.currentActiveRuleSetId;

  const activeRuleSetSession = useQuery(
    api.bookingSessions.getActiveForUser,
    currentPractice && practiceActiveRuleSetId
      ? {
          practiceId: currentPractice._id,
          ruleSetId: practiceActiveRuleSetId,
        }
      : "skip",
  );
  const bookedAppointments = useQuery(
    api.appointments.getBookedAppointmentsForCurrentUser,
    {
      refreshNonce: bookedAppointmentRefreshNonce,
      ...(practiceActiveRuleSetId
        ? { activeRuleSetId: practiceActiveRuleSetId }
        : {}),
    },
  );
  const practitioners = useQuery(
    api.entities.getPractitioners,
    practiceActiveRuleSetId ? { ruleSetId: practiceActiveRuleSetId } : "skip",
  );

  // Mutations
  const createSession = useMutation(api.bookingSessions.create);
  const goBackToStep = useMutation(api.bookingSessions.goBackToStep);
  const removeSession = useMutation(api.bookingSessions.remove);

  useEffect(() => {
    if (
      !practicesQuery ||
      practicesQuery.length > 0 ||
      isInitializingPracticeRef.current
    ) {
      return;
    }
    isInitializingPracticeRef.current = true;
    initializeDefaultPractice()
      .catch((error: unknown) => {
        console.error("Failed to initialize practice membership:", error);
      })
      .finally(() => {
        isInitializingPracticeRef.current = false;
      });
  }, [initializeDefaultPractice, practicesQuery]);

  useEffect(() => {
    if (
      currentPractice &&
      practiceActiveRuleSetId &&
      bookedAppointments?.length === 0 &&
      !isCreatingSessionRef.current &&
      !sessionError &&
      activeRuleSetSession !== undefined &&
      !activeRuleSetSession
    ) {
      isCreatingSessionRef.current = true;
      void wrapAsyncResult(
        () =>
          createSession({
            practiceId: currentPractice._id,
            ruleSetId: practiceActiveRuleSetId,
          }),
        (error) =>
          frontendErrorFromUnknown(error, {
            kind: "unknown",
            message: "Buchung konnte nicht gestartet werden.",
            source: "BookingPage.createSession",
          }),
      )
        .match(
          () => void 0,
          (error) => {
            captureFrontendError(error, {
              context: "BookingPage.createSession",
              practiceId: currentPractice._id,
              ruleSetId: practiceActiveRuleSetId,
            });
            setSessionError(error.message);
            toast.error("Buchung konnte nicht gestartet werden", {
              description:
                "Bitte versuchen Sie es erneut oder kontaktieren Sie die Praxis.",
            });
          },
        )
        .finally(() => {
          isCreatingSessionRef.current = false;
        });
    }
  }, [
    currentPractice,
    practiceActiveRuleSetId,
    bookedAppointments,
    createSession,
    sessionError,
    activeRuleSetSession,
  ]);

  // Handle retry after session creation error
  const handleRetrySessionCreation = useCallback(() => {
    setSessionError(null);
  }, []);

  // Handle starting over
  const handleStartOver = useCallback(() => {
    setDisplayStepOverride(null);
    if (currentPractice && practiceActiveRuleSetId) {
      void removeSession({
        practiceId: currentPractice._id,
        ruleSetId: practiceActiveRuleSetId,
      });
    }
  }, [currentPractice, practiceActiveRuleSetId, removeSession]);

  const handleBookedAppointmentCancelled = useCallback(() => {
    setSessionError(null);
    setBookedAppointmentRefreshNonce((current) => current + 1);
  }, []);

  const handleBack = useCallback(() => {
    if (!activeRuleSetSession) {
      return;
    }
    const currentState = buildDisplayedBookingState(
      activeRuleSetSession.state,
      displayStepOverride,
    );
    const previousStep = getPreviousDisplayStep(currentState);
    if (previousStep === null) {
      setDisplayStepOverride(null);
      return;
    }
    if (!isServerBackTargetStep(previousStep)) {
      return;
    }

    void wrapAsyncResult(
      () =>
        goBackToStep({
          practiceId: activeRuleSetSession.practiceId,
          ruleSetId: activeRuleSetSession.ruleSetId,
          targetStep: previousStep,
        }),
      (error) =>
        frontendErrorFromUnknown(error, {
          kind: "unknown",
          message: "Zurückgehen fehlgeschlagen.",
          source: "BookingPage.handleBack",
        }),
    ).match(
      () => {
        setDisplayStepOverride(null);
      },
      (error) => {
        captureFrontendError(error, {
          context: "BookingPage.handleBack",
          targetStep: previousStep,
        });
        toast.error("Zurückgehen fehlgeschlagen", {
          description: error.message || "Bitte versuchen Sie es erneut.",
        });
      },
    );
  }, [activeRuleSetSession, displayStepOverride, goBackToStep]);

  const handleSignOut = useCallback(() => {
    void wrapAsyncResult(
      () => {
        signOut();
      },
      (error) =>
        frontendErrorFromUnknown(error, {
          kind: "unknown",
          message: "Abmeldung fehlgeschlagen.",
          source: "BookingPage.handleSignOut",
        }),
    ).match(
      () => void 0,
      (error) => {
        captureFrontendError(error, {
          context: "BookingPage.handleSignOut",
        });
        toast.error("Abmeldung fehlgeschlagen", {
          description: error.message || "Bitte versuchen Sie es erneut.",
        });
      },
    );
  }, [signOut]);
  const effectiveDisplayStepOverride =
    bookedAppointments !== undefined && bookedAppointments.length > 0
      ? null
      : displayStepOverride !== null &&
          activeRuleSetSession?.state.step === displayStepOverride
        ? null
        : displayStepOverride;
  const displayedState = activeRuleSetSession
    ? buildDisplayedBookingState(
        activeRuleSetSession.state,
        effectiveDisplayStepOverride,
      )
    : null;
  const currentStep = displayedState?.step;

  const handleForward = useCallback(() => {
    const container = stepContainerRef.current;
    if (!container) {
      return;
    }

    const submitButtons = [
      ...container.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        'button[type="submit"], input[type="submit"]',
      ),
    ];
    const firstEnabled = submitButtons.find((button) => {
      const isVisible = button.offsetParent !== null;
      const ariaDisabled = button.getAttribute("aria-disabled") === "true";
      return isVisible && !button.disabled && !ariaDisabled;
    });

    firstEnabled?.click();
  }, []);

  useHotkey(
    "Mod+Z",
    () => {
      if (currentStep && canGoBack(currentStep)) {
        handleBack();
      }
    },
    {
      conflictBehavior: "replace",
      enabled: Boolean(activeRuleSetSession),
      requireReset: true,
    },
  );

  useHotkey(
    "Mod+Shift+Z",
    () => {
      handleForward();
    },
    {
      conflictBehavior: "replace",
      enabled: Boolean(activeRuleSetSession),
      requireReset: true,
    },
  );

  useHotkey(
    "Mod+Y",
    () => {
      handleForward();
    },
    {
      conflictBehavior: "replace",
      enabled: Boolean(activeRuleSetSession),
      requireReset: true,
    },
  );

  useHotkey(
    "Alt+ArrowLeft",
    () => {
      if (currentStep && canGoBack(currentStep)) {
        handleBack();
      }
    },
    {
      conflictBehavior: "replace",
      enabled: Boolean(activeRuleSetSession),
      requireReset: true,
    },
  );

  useHotkey(
    "Alt+ArrowRight",
    () => {
      handleForward();
    },
    {
      conflictBehavior: "replace",
      enabled: Boolean(activeRuleSetSession),
      requireReset: true,
    },
  );

  const nextBookedAppointment = bookedAppointments?.[0];
  const bookedAppointmentId = nextBookedAppointment
    ? `${nextBookedAppointment.kind}:${String(nextBookedAppointment._id)}`
    : undefined;
  const bookedAppointmentStart = nextBookedAppointment?.start;
  useEffect(() => {
    if (!bookedAppointmentStart) {
      return;
    }

    let refreshDelayMs = 0;
    try {
      const appointmentStartEpochMs = Temporal.ZonedDateTime.from(
        bookedAppointmentStart,
      ).epochMilliseconds;
      const delayMs = appointmentStartEpochMs - Date.now();
      refreshDelayMs = Math.max(0, delayMs + 100);
    } catch {
      refreshDelayMs = 0;
    }

    const timeoutId = setTimeout(
      () => {
        setBookedAppointmentRefreshNonce((current) => current + 1);
      },
      Math.min(refreshDelayMs, 2_147_483_647),
    );

    return () => {
      clearTimeout(timeoutId);
    };
  }, [bookedAppointmentId, bookedAppointmentStart]);

  const isShowingBookedAppointment =
    bookedAppointments !== undefined && bookedAppointments.length > 0;
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
  if (!practiceActiveRuleSetId) {
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
  if (!isShowingBookedAppointment && sessionError) {
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

  if (!isShowingBookedAppointment && activeRuleSetSession === undefined) {
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

  if (!isShowingBookedAppointment && activeRuleSetSession === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Buchungsdaten fehlen</CardTitle>
            <CardDescription>
              Ihre gespeicherten Buchungsangaben konnten nicht geladen werden.
              Bitte starten Sie den Buchungsvorgang erneut.
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

  let currentGroup: ReturnType<typeof getStepGroup>;
  let showBackButton: boolean;
  let stepContent: ReactElement;

  if (isShowingBookedAppointment) {
    const practitionerNamesById = new Map<Id<"practitioners">, string>(
      (practitioners ?? []).flatMap((practitioner) => [
        [practitioner._id, practitioner.name] as const,
        [practitioner.lineageKey, practitioner.name] as const,
      ]),
    );

    currentGroup = "booking";
    showBackButton = false;
    stepContent = (
      <BookedAppointmentsSummary
        appointments={bookedAppointments}
        onCancelled={handleBookedAppointmentCancelled}
        practitionerNamesById={practitionerNamesById}
      />
    );
  } else {
    if (!activeRuleSetSession || !displayedState) {
      const error = invalidStateError(
        "Booking flow missing while rendering booking wizard",
        "AuthenticatedBookingFlow",
      );
      stepContent = (
        <Card className="max-w-xl mx-auto">
          <CardHeader>
            <CardTitle>Sitzung konnte nicht geladen werden</CardTitle>
            <CardDescription>{error.message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleStartOver}>Buchung neu starten</Button>
          </CardContent>
        </Card>
      );
      currentGroup = "info";
      showBackButton = false;
    } else {
      currentGroup = getStepGroup(displayedState.step);
      showBackButton = canGoBack(displayedState.step);
      stepContent = (
        <StepRenderer
          onStartOver={handleStartOver}
          step={displayedState.step}
          stepProps={{
            practiceId: currentPractice._id,
            ruleSetId: practiceActiveRuleSetId,
            state: displayedState,
          }}
        />
      );
    }
  }

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
              onClick={() => {
                handleBack();
              }}
              variant="ghost"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Zurück
            </Button>
          </div>
        )}

        {/* Step content */}
        <div className="max-w-2xl mx-auto" ref={stepContainerRef}>
          {stepContent}
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
  switch (getBookingSessionStepKind(step)) {
    case "calendar-selection": {
      return <CalendarSelectionStep {...stepProps} />;
    }
    case "data-input": {
      return <DataInputStep {...stepProps} />;
    }
    case "data-sharing": {
      return <DataSharingStep {...stepProps} />;
    }
    case "doctor-selection": {
      return <DoctorSelectionStep {...stepProps} />;
    }
    case "gkv-details": {
      return <GkvDetailsStep {...stepProps} />;
    }
    case "insurance-type": {
      return <InsuranceTypeStep {...stepProps} />;
    }
    case "location": {
      return <LocationStep {...stepProps} />;
    }
    case "patient-status": {
      return <PatientStatusStep {...stepProps} />;
    }
    case "pkv-details": {
      return <PkvDetailsStep {...stepProps} />;
    }
    case "privacy": {
      return <PrivacyStep {...stepProps} />;
    }
    case "pvs-consent": {
      return <PvsConsentStep {...stepProps} />;
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
