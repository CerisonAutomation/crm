import { aliasToView } from "@/lib/view-alias";

/**
 * `/forgot-password` — canonical password-recovery request URL (the actual
 * reset lands on `/reset-password?token=…`, which is a full route).
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return aliasToView("forgot-password", searchParams);
}
