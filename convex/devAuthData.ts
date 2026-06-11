export const DEV_AUTH_ORGANIZATION_ID = "org_dev_preview";
export const DEV_AUTH_PRACTICE_NAME = "Standardpraxis";

export const DEV_AUTH_USERS = [
  {
    authId: "dev-patient",
    email: "patient@preview.test",
    firstName: "Preview",
    lastName: "Patient",
  },
  {
    authId: "dev-staff",
    email: "staff@preview.test",
    firstName: "Preview",
    lastName: "Staff",
    role: "staff",
  },
  {
    authId: "dev-admin",
    email: "admin@preview.test",
    firstName: "Preview",
    lastName: "Admin",
    role: "admin",
  },
  {
    authId: "dev-owner",
    email: "owner@preview.test",
    firstName: "Preview",
    lastName: "Owner",
    role: "owner",
  },
] as const;

export function isDevAuthUserId(authId: string): boolean {
  return DEV_AUTH_USERS.some((user) => user.authId === authId);
}
