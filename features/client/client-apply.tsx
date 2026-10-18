"use client";

/**
 * The apply hub — what "Start my application" means once you are signed in.
 *
 * The menu item used to drop a client straight into the onboarding wizard,
 * which answered "how do I finish the form I started" and not "what can I apply
 * for, and where am I". This is the surface that answers both:
 *
 *  1. everything the firm can file, in one list, filterable by what it is —
 *     so a signed-in client can see the whole catalogue rather than one
 *     dropdown inside step 4 of a wizard;
 *  2. the stage of the application they already have, using the SAME stage
 *     machinery as the case dashboard (`stageInfoFor` + `ProgressStepper`),
 *     so the two surfaces can never disagree about where a case stands;
 *  3. highlights for whatever the desk is waiting on — open document requests
 *     first, because those are the ones with a clock attached.
 *
 * Choosing a route hands it to the onboarding wizard through the same
 * `saveGuidedDraft` handoff the public intake uses, so the wizard opens knowing
 * which route the client picked.
 */
import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/lib/store";
import { api, type CaseView } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Eyebrow, Spinner } from "@/components/brand/ui";
import { ProgressStepper, stageInfoFor } from "@/features/client/progress-stepper";
import { saveGuidedDraft } from "@/lib/guided-draft";

type CatalogRow = Awaited<ReturnType<typeof api.catalog>>["programmes"][number];

export function ClientApply() {
  const { t } = useI18n();
  const setView = useApp((s) => s.setView);
  const [caseView, setCaseView] = useState<CaseView | null>(null);
  const [routes, setRoutes] = useState<CatalogRow[]>([]);
  const [kind, setKind] = useState<"ALL" | "CITIZENSHIP" | "RESIDENCE">("ALL");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    // The catalogue is the public one (`/api/catalog`): it is the same list the
    // marketing site shows, so a client sees every route the firm discloses —
    // not just the subset flagged active for service selection.
    Promise.all([
      api.myCase().then((r) => r.case).catch(() => null),
      api.catalog().then((r) => r.programmes).catch(() => []),
    ])
      .then(([c, p]) => {
        if (!live) return;
        setCaseView(c);
        setRoutes(p);
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const openRequests = useMemo(
    () => caseView?.requests.filter((r) => r.status === "OPEN") ?? [],
    [caseView],
  );
  const stage = caseView ? stageInfoFor(caseView.status, caseView.timeline, openRequests.length) : null;

  const shown = useMemo(
    () => (kind === "ALL" ? routes : routes.filter((r) => r.kind === kind)),
    [routes, kind],
  );
  const counts = useMemo(
    () => ({
      ALL: routes.length,
      CITIZENSHIP: routes.filter((r) => r.kind === "CITIZENSHIP").length,
      RESIDENCE: routes.filter((r) => r.kind === "RESIDENCE").length,
    }),
    [routes],
  );

  /** Hand the chosen route to the wizard, exactly as the public intake does. */
  function applyFor(key: string) {
    saveGuidedDraft({ intent: null, programmeKey: key, answers: {}, savedAt: new Date().toISOString() });
    setView("client-onboarding");
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8" aria-busy="true">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-10 md:px-8 md:py-12">
      <Eyebrow>{t("clap.eyebrow")}</Eyebrow>
      <h1 className="mt-3 font-editorial type-h1 text-cobble-ink">{t("clap.title")}</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-iron-ink">{t("clap.sub")}</p>

      {/* ── Their application, and anything the desk is waiting on ─────────── */}
      {caseView ? (
        <section className="mt-10 border border-border/70 bg-card" aria-labelledby="clap-mine">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div>
              <h2 id="clap-mine" className="font-editorial text-lg text-cobble-ink">
                {t("clap.yourApplication")}
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {caseView.reference}
                {caseView.programme ? ` · ${caseView.programme.name}` : ""}
              </p>
            </div>
            <Button
              variant="outline"
              className="rounded-none border-cobble px-4 py-2 text-[11px] tracking-[0.14em] text-cobble-ink hover:bg-cobble hover:text-[#F5F1EA]"
              onClick={() => setView("client-dashboard")}
            >
              {t("clap.openCase")}
            </Button>
          </div>

          {stage && (
            <div className="px-5 py-5">
              <ProgressStepper info={stage} />
            </div>
          )}

          {/* The one thing that needs them now, stated as a count rather than a
              status word: an open request is the desk blocked on their action. */}
          {openRequests.length > 0 ? (
            <div className="border-t border-gold/40 bg-gold/[0.07] px-5 py-4">
              <p className="flex items-center gap-2 text-[13px] font-medium text-cobble-ink">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
                {t("clap.awaited", { count: openRequests.length })}
              </p>
              <ul className="mt-2 space-y-1 pl-4 text-[13px] text-iron-ink">
                {openRequests.slice(0, 4).map((r) => (
                  <li key={r.id} className="list-disc">
                    {r.title}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="border-t border-border/60 px-5 py-4">
              <p className="text-[13px] text-muted-foreground">{t("clap.nothingAwaited")}</p>
            </div>
          )}
        </section>
      ) : (
        <section className="mt-10 border-l-2 border-gold bg-limestone/20 p-5" aria-labelledby="clap-none">
          <h2 id="clap-none" className="font-editorial text-lg text-cobble-ink">
            {t("clap.noApplication")}
          </h2>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-iron-ink">{t("clap.noApplicationBody")}</p>
        </section>
      )}

      {/* ── Everything they can apply for ─────────────────────────────────── */}
      <section className="mt-12" aria-labelledby="clap-routes">
        <h2 id="clap-routes" className="font-editorial type-h2 text-cobble-ink">
          {t("clap.routesTitle")}
        </h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-iron-ink">{t("clap.routesSub")}</p>

        <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label={t("clap.routesTitle")}>
          {(["ALL", "CITIZENSHIP", "RESIDENCE"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={cn(
                "border px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors",
                kind === k
                  ? "border-cobble bg-cobble text-[#F5F1EA]"
                  : "border-border text-iron-ink hover:border-cobble hover:text-cobble-ink",
              )}
            >
              {t(
                k === "ALL"
                  ? "landing.programmes.all"
                  : k === "CITIZENSHIP"
                    ? "landing.programmes.citizenship"
                    : "landing.programmes.residence",
              )}{" "}
              ({counts[k]})
            </button>
          ))}
        </div>

        <ul className="mt-6 grid gap-4 md:grid-cols-2">
          {shown.map((r) => {
            const mine = caseView?.programme?.key === r.key;
            return (
              <li
                key={r.key}
                className={cn(
                  "flex flex-col border bg-card p-5",
                  mine ? "border-gold/60 bg-gold/[0.05]" : "border-border/70",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="eyebrow text-muted-foreground">{r.country}</p>
                    <h3 className="mt-1 font-editorial text-[17px] leading-snug text-cobble-ink">{r.name}</h3>
                  </div>
                  {mine && (
                    <span className="shrink-0 border border-gold/60 bg-gold/15 px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] text-cobble-ink">
                      {t("clap.yourRoute")}
                    </span>
                  )}
                </div>
                <p className="mt-3 flex-1 text-[13px] leading-relaxed text-iron-ink">{r.summary}</p>
                <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
                  {r.minInvestment > 0 && (
                    <div className="flex gap-1">
                      <dt>{t("clap.from")}</dt>
                      <dd className="tabular-nums text-iron-ink">
                        {r.currency} {r.minInvestment.toLocaleString("en-CH")}
                      </dd>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <dt>{t("clap.weeksLabel")}</dt>
                    <dd className="tabular-nums text-iron-ink">{r.processingWeeks}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt>{t("clap.authorityLabel")}</dt>
                    <dd className="text-iron-ink">{r.authority}</dd>
                  </div>
                </dl>
                <Button
                  variant="outline"
                  className="mt-4 w-full rounded-none border-cobble py-2.5 text-[11px] tracking-[0.14em] text-cobble-ink hover:bg-cobble hover:text-[#F5F1EA]"
                  onClick={() => applyFor(r.key)}
                >
                  {mine ? t("clap.continueRoute") : t("clap.applyFor")}
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
