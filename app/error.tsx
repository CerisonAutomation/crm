"use client";
/**
 * App-level error boundary (App Router `error.tsx`). Catches render/runtime
 * errors in the app segment so people see a branded, recoverable screen instead
 * of the framework default. Must be a Client Component.
 */
import { useEffect } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { reportClientError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { PassportSeal } from "@/components/brand/devices";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    reportClientError(error, { digest: error.digest, scope: "app" });
  }, [error]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <PassportSeal size={64} />
      <h1 className="font-editorial text-3xl text-cobble-ink">{t("error.title")}</h1>
      <p className="max-w-md text-sm leading-relaxed text-iron-ink">{t("error.body")}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          onClick={() => reset()}
          className="cta px-6 py-5 text-xs tracking-[0.16em]"
        >
          {t("error.retry")}
        </Button>
        <Button
          asChild
          variant="ghost"
          className="rounded-none px-6 py-5 text-xs tracking-[0.16em] uppercase text-iron-ink hover:text-gold-ink"
        >
          <Link href="/">{t("error.home")}</Link>
        </Button>
      </div>
    </main>
  );
}
