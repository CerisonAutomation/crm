"use client";
/** Branded 404 — shown for any unmatched route. */
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { PassportSeal } from "@/components/brand/devices";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <PassportSeal size={64} />
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gold-ink">404</p>
      <h1 className="font-editorial text-3xl text-cobble-ink">{t("notFound.title")}</h1>
      <p className="max-w-md text-sm leading-relaxed text-iron-ink">{t("notFound.body")}</p>
      <Button
        asChild
        className="cta px-6 py-5 text-xs tracking-[0.16em]"
      >
        <Link href="/">{t("notFound.cta")}</Link>
      </Button>
    </main>
  );
}
