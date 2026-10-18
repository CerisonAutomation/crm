import { aliasToView } from "@/lib/view-alias";

/**
 * `/procedure` — canonical URL for the Austria citizenship-for-descendants
 * procedure flow, the public step-by-step journey from "my ancestor was
 * persecuted" to "my case is with the desk".
 */
export default async function ProcedurePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return aliasToView("procedure", searchParams);
}