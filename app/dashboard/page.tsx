import { aliasToView } from "@/lib/view-alias";

/**
 * `/dashboard` — canonical app entry. Resolves to the signed-in visitor's
 * role-appropriate dashboard, or to sign-in for a guest (the PWA shortcut
 * behaviour, available as a plain URL).
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return aliasToView("dashboard", searchParams);
}
