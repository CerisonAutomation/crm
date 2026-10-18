"use client";
/** Route-transition loading UI — the shared surface loader announces itself. */
import { useI18n } from "@/lib/i18n";
import { SurfaceLoader } from "@/components/brand/ui";

export default function Loading() {
  const { t } = useI18n();
  return <SurfaceLoader label={t("common.loading")} />;
}
