import { aliasToView } from "@/lib/view-alias";

/**
 * `/signup` — canonical account-creation URL. Hands off to the SPA sign-up
 * view, so marketing links and emails can use a stable path.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return aliasToView("signup", searchParams);
}
