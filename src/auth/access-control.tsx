import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useAuth } from "@workos-inc/authkit-react";
import { useConvexAuth, useQuery } from "convex/react";
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/convex/_generated/api";

import { isAuthBypassEnabled } from "./auth-bypass";
import {
  type DevAuthPersona,
  getDevAuthPersonaAccess,
  getDevAuthPersonaForPath,
} from "./dev-auth-jwt";

const STAFF_ROLES = ["staff", "admin", "owner"] as const;
const PRAXISMANAGER_ROLES = ["admin", "owner"] as const;
const ACCOUNT_MANAGER_ROLES = ["owner"] as const;

const STAFF_PERMISSIONS = ["praxisplaner:read"] as const;
const PRAXISMANAGER_PERMISSIONS = ["regeln:read"] as const;

interface AccessRequirement {
  permissions: readonly string[];
  roles: readonly string[];
}

const STAFF_ACCESS = {
  permissions: STAFF_PERMISSIONS,
  roles: STAFF_ROLES,
} satisfies AccessRequirement;

const PRAXISMANAGER_ACCESS = {
  permissions: PRAXISMANAGER_PERMISSIONS,
  roles: PRAXISMANAGER_ROLES,
} satisfies AccessRequirement;

const ACCOUNT_MANAGER_ACCESS = {
  permissions: [],
  roles: ACCOUNT_MANAGER_ROLES,
} satisfies AccessRequirement;

export function AccountAuthGate({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const { permissions, role, roles } = useAuth();
  const access = isAuthBypassEnabled()
    ? getDevAuthPersonaAccess("owner")
    : { permissions, role, roles };

  return (
    <AuthenticatedGate devPersona="owner">
      {hasRequiredAccess({
        ...access,
        requirement: ACCOUNT_MANAGER_ACCESS,
      }) || isUnaffiliatedAccountAccess(access) ? (
        children
      ) : (
        <UnauthorizedScreen />
      )}
    </AuthenticatedGate>
  );
}

export function AuthenticatedGate({
  children,
  devPersona,
}: {
  children: ReactNode;
  devPersona?: DevAuthPersona;
}): ReactElement {
  const convexAuth = useConvexAuth();
  const { isLoading, signIn, user } = useAuth();
  const [signInError, setSignInError] = useState<null | string>(null);
  const signInRequestedRef = useRef(false);

  const startSignIn = useCallback(() => {
    if (signInRequestedRef.current) {
      return;
    }
    signInRequestedRef.current = true;
    signIn({ state: getAuthReturnState(devPersona) }).catch(
      (error: unknown) => {
        signInRequestedRef.current = false;
        setSignInError(
          error instanceof Error
            ? error.message
            : "Anmeldung konnte nicht gestartet werden",
        );
      },
    );
  }, [devPersona, signIn]);

  useEffect(() => {
    if (isLoading || user || isAuthBypassEnabled()) {
      return;
    }
    startSignIn();
  }, [isLoading, startSignIn, user]);

  const authBypassEnabled = isAuthBypassEnabled();
  const activeDevPersona = authBypassEnabled && isDevPersonaActive(devPersona);
  const shouldWaitForConvexAuth = authBypassEnabled ? activeDevPersona : true;

  if (isLoading || (shouldWaitForConvexAuth && convexAuth.isLoading)) {
    return <AuthLoadingScreen />;
  }

  if (activeDevPersona) {
    return convexAuth.isAuthenticated ? <>{children}</> : <AuthLoadingScreen />;
  }

  if (!user) {
    return (
      <SignInScreen
        error={signInError}
        onRetry={() => {
          setSignInError(null);
          startSignIn();
        }}
      />
    );
  }

  if (shouldWaitForConvexAuth && !convexAuth.isAuthenticated) {
    return (
      <SignInScreen
        error="Die Anmeldung ist abgelaufen. Bitte starten Sie die Anmeldung erneut."
        onRetry={() => {
          setSignInError(null);
          signInRequestedRef.current = false;
          startSignIn();
        }}
      />
    );
  }

  return <>{children}</>;
}

export function getAuthReturnState(devPersona?: DevAuthPersona): {
  practiceSlug?: string;
  returnTo: string;
} {
  const returnTo = getAuthReturnToPath();
  const practiceSlug =
    devPersona === "patient" ? getBookingPracticeSlugFromPath() : null;
  return {
    ...(practiceSlug ? { practiceSlug } : {}),
    returnTo,
  };
}

export function hasPraxismanagerAccess(access: {
  permissions: readonly string[];
  role: null | string;
  roles: null | readonly string[];
}): boolean {
  return hasRequiredAccess({
    ...access,
    requirement: PRAXISMANAGER_ACCESS,
  });
}

export function hasRequiredAccess({
  permissions,
  requirement,
  role,
  roles,
}: {
  permissions: readonly string[];
  requirement: AccessRequirement;
  role: null | string;
  roles: null | readonly string[];
}): boolean {
  if (
    requirement.permissions.some((permission) =>
      permissions.includes(permission),
    )
  ) {
    return true;
  }

  const roleSet = new Set([...(roles ?? []), ...(role ? [role] : [])]);
  return requirement.roles.some((requiredRole) => roleSet.has(requiredRole));
}

export function isUnaffiliatedAccountAccess({
  permissions,
  role,
  roles,
}: {
  permissions: readonly string[];
  role: null | string;
  roles: null | readonly string[];
}): boolean {
  return (
    role === null && (roles?.length ?? 0) === 0 && permissions.length === 0
  );
}

export function PatientAuthGate({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <AuthenticatedGate devPersona="patient">
      <BlockedPatientGate>{children}</BlockedPatientGate>
    </AuthenticatedGate>
  );
}

export function PraxismanagerAuthGate({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <AuthorizedGate devPersona="admin" requirement={PRAXISMANAGER_ACCESS}>
      {children}
    </AuthorizedGate>
  );
}

export function StaffAuthGate({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <AuthorizedGate devPersona="staff" requirement={STAFF_ACCESS}>
      {children}
    </AuthorizedGate>
  );
}

function AuthLoadingScreen(): ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-96">
        <CardContent className="py-6">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Spinner />
            <span>Anmeldung wird geprüft...</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AuthorizedGate({
  children,
  devPersona,
  requirement,
}: {
  children: ReactNode;
  devPersona: DevAuthPersona;
  requirement: AccessRequirement;
}): ReactElement {
  const { permissions, role, roles } = useAuth();
  const access = isAuthBypassEnabled()
    ? getDevAuthPersonaAccess(devPersona)
    : { permissions, role, roles };

  return (
    <AuthenticatedGate devPersona={devPersona}>
      {hasRequiredAccess({ ...access, requirement }) ? (
        children
      ) : (
        <UnauthorizedScreen />
      )}
    </AuthenticatedGate>
  );
}

function BlockedPatientGate({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const practiceSlug = getBookingPracticeSlugFromPath();
  const block = useQuery(
    api.onlineAccountBlocks.getCurrentUserBlockByPracticeSlug,
    practiceSlug ? { practiceSlug } : "skip",
  );

  if (!practiceSlug) {
    return <>{children}</>;
  }

  if (block === undefined) {
    return <AuthLoadingScreen />;
  }

  if (block) {
    return <BlockedPatientScreen />;
  }

  return <>{children}</>;
}

function BlockedPatientScreen(): ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md">
        <CardContent className="space-y-1 py-6 text-sm leading-6">
          <p>Sehr geehrte/r Patient/in,</p>
          <p>aufgrund Ihrer individuellen Anforderungen bitten wir Sie,</p>
          <p>Ihre Termine zukünftig telefonischzu vereinbaren.</p>
          <p>Auf diesem Wege können wir sicherstellen,</p>
          <p>dass wir Ihren Bedürfnissen bestmöglich gerecht werden.</p>
          <p>Vielen Dank für Ihr Verständnis.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function getAuthReturnToPath(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
}

function getBookingPracticeSlugFromPath(): null | string {
  const pathSegments = globalThis.location.pathname.split("/").filter(Boolean);
  const [practiceSlug] = pathSegments;
  return pathSegments.length === 1 && practiceSlug ? practiceSlug : null;
}

function isDevPersonaActive(persona: DevAuthPersona | undefined): boolean {
  if (!persona) {
    return true;
  }
  if (import.meta.env.SSR) {
    return true;
  }
  return getDevAuthPersonaForPath(globalThis.location.pathname) === persona;
}

function SignInScreen({
  error,
  onRetry,
}: {
  error: null | string;
  onRetry: () => void;
}): ReactElement {
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
          {error ? (
            <div className="space-y-3">
              <p className="text-sm text-destructive">{error}</p>
              <Button className="w-full" onClick={onRetry}>
                Erneut versuchen
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Spinner />
              <span>Anmeldung wird geöffnet...</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UnauthorizedScreen(): ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Zugriff nicht erlaubt</CardTitle>
          <CardDescription>
            Ihr Konto hat nicht die erforderliche Berechtigung für diese Seite.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
