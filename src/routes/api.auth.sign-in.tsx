import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { z } from "zod";

const signInSearchSchema = z.object({
  practiceSlug: z.string().optional(),
  returnTo: z.string().catch("/"),
});
type SignInSearch = z.infer<typeof signInSearchSchema>;

export const Route = createFileRoute("/api/auth/sign-in")({
  beforeLoad: async ({ search }) => {
    const returnTo = sanitizeReturnPath(search.returnTo);
    const callbackReturnPath = createCallbackReturnPath({
      ...(search.practiceSlug ? { practiceSlug: search.practiceSlug } : {}),
      returnTo,
    });
    const signInUrl = await getSignInUrl({ data: callbackReturnPath });
    return redirect({ href: signInUrl });
  },
  validateSearch: validateSignInSearch,
});

function createCallbackReturnPath({
  practiceSlug,
  returnTo,
}: {
  practiceSlug?: string;
  returnTo: string;
}): string {
  const searchParams = new URLSearchParams({ returnTo });
  if (practiceSlug) {
    searchParams.set("practiceSlug", practiceSlug);
  }
  return `/callback?${searchParams.toString()}`;
}

function sanitizeReturnPath(returnTo: string): string {
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) {
    return "/";
  }
  if (returnTo === "/callback" || returnTo.startsWith("/callback?")) {
    return "/";
  }
  return returnTo;
}

function validateSignInSearch(search: unknown): SignInSearch {
  const result = signInSearchSchema.safeParse(search);
  if (result.success) {
    return result.data;
  }
  return { returnTo: "/" };
}
