import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useAuth } from "@workos-inc/authkit-react";
import { Loader2 } from "lucide-react";
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

import {
  type DevAuthPersona,
  getDevAuthPersonaAccess,
  getDevAuthPersonaForPath,
} from "./dev-auth-jwt";
import { getConfiguredWorkOSOrganizationId } from "./workos-organization";

const STAFF_ROLES = ["staff", "admin", "owner"] as const;
const PRAXISMANAGER_ROLES = ["admin", "owner"] as const;

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

export function PatientAuthGate({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <AuthenticatedGate devPersona="patient">{children}</AuthenticatedGate>;
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

function AuthenticatedGate({
  children,
  devPersona,
  requireConfiguredOrganization = false,
}: {
  children: ReactNode;
  devPersona?: DevAuthPersona;
  requireConfiguredOrganization?: boolean;
}): ReactElement {
  const { isLoading, organizationId, signIn, switchToOrganization, user } =
    useAuth();
  const [signInError, setSignInError] = useState<null | string>(null);
  const signInRequestedRef = useRef(false);
  const organizationSwitchRequestedRef = useRef(false);
  const configuredOrganizationId = requireConfiguredOrganization
    ? getConfiguredWorkOSOrganizationId()
    : undefined;

  const startSignIn = useCallback(() => {
    if (signInRequestedRef.current) {
      return;
    }
    signInRequestedRef.current = true;
    const returnTo = getAuthReturnToPath();
    signIn({
      ...(configuredOrganizationId
        ? { organizationId: configuredOrganizationId }
        : {}),
      state: { returnTo },
    }).catch((error: unknown) => {
      signInRequestedRef.current = false;
      setSignInError(
        error instanceof Error
          ? error.message
          : "Anmeldung konnte nicht gestartet werden",
      );
    });
  }, [configuredOrganizationId, signIn]);

  useEffect(() => {
    if (isLoading || user || isAuthBypassEnabled()) {
      return;
    }
    startSignIn();
  }, [isLoading, startSignIn, user]);

  useEffect(() => {
    if (
      isLoading ||
      !user ||
      isAuthBypassEnabled() ||
      !configuredOrganizationId ||
      organizationId === configuredOrganizationId ||
      organizationSwitchRequestedRef.current
    ) {
      return;
    }

    organizationSwitchRequestedRef.current = true;
    const returnTo = getAuthReturnToPath();
    switchToOrganization({
      organizationId: configuredOrganizationId,
      signInOpts: { state: { returnTo } },
    }).catch((error: unknown) => {
      organizationSwitchRequestedRef.current = false;
      setSignInError(
        error instanceof Error
          ? error.message
          : "Organisation konnte nicht gewechselt werden",
      );
    });
  }, [
    configuredOrganizationId,
    isLoading,
    organizationId,
    switchToOrganization,
    user,
  ]);

  if (isAuthBypassEnabled() && isDevPersonaActive(devPersona)) {
    return <>{children}</>;
  }

  if (isLoading) {
    return <AuthLoadingScreen />;
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

  if (configuredOrganizationId && organizationId !== configuredOrganizationId) {
    return <AuthLoadingScreen />;
  }

  return <>{children}</>;
}

function AuthLoadingScreen(): ReactElement {
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
    <AuthenticatedGate devPersona={devPersona} requireConfiguredOrganization>
      {hasRequiredAccess({ ...access, requirement }) ? (
        children
      ) : (
        <UnauthorizedScreen />
      )}
    </AuthenticatedGate>
  );
}

function getAuthReturnToPath(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
}

function isAuthBypassEnabled(): boolean {
  if (import.meta.env.DEV) {
    return true;
  }

  const bypassFlag = import.meta.env["VITE_AUTH_BYPASS_ENABLED"] === "true";
  if (!bypassFlag) {
    return false;
  }

  const vercelEnv = import.meta.env["VITE_VERCEL_ENV"] as string | undefined;
  return vercelEnv === "preview";
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
              <Loader2 className="h-4 w-4 animate-spin" />
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
