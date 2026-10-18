import { aliasToView } from "@/lib/view-alias";

/**
 * `/guided` — canonical URL for the guided intake, the public step-by-step
 * eligibility questionnaire (the landing hero's primary CTA).
 */
export default async function GuidedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return aliasToView("guided", searchParams);
}
