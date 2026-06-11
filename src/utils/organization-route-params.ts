export function readOrganizationSlugParam(params: unknown): string {
  if (
    typeof params === "object" &&
    params !== null &&
    "organizationSlug" in params
  ) {
    const organizationSlug = params.organizationSlug;
    if (typeof organizationSlug === "string" && organizationSlug.length > 0) {
      return organizationSlug;
    }
  }

  return "";
}
