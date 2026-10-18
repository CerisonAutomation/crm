import { aliasToView } from "@/lib/view-alias";

/**
 * `/login` — canonical sign-in URL. Hands off to the SPA sign-in view, so
 * emails, bookmarks and external links can use a stable path.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return aliasToView("login", searchParams);
}
