export function getConfiguredWorkOSOrganizationId(): string | undefined {
  const organizationId = import.meta.env["VITE_WORKOS_ORGANIZATION_ID"] as
    | string
    | undefined;
  const trimmed = organizationId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}
