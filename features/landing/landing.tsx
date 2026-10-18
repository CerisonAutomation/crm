"use client";
/**
 * Landing — Citizen Lane editorial entrance.
 *
 * App-like chrome (sticky translucent header + in-page nav + skip link) so the
 * public entry reads as a product, not a brochure. Brand devices are used with
 * restraint: gold seal, rotating slogan ring, lattice band. All visible copy is
 * translated via useI18n(); the locale switcher lives in the footer.
 */
import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n, type StringKey } from "@/lib/i18n";
import { useBrand } from "@/lib/brand/client";
import { CANON_BRAND } from "@/lib/brand/defaults";
import {
  LatticePattern,
  PassportSeal,
  Wordmark,
  SloganRing,
} from "@/components/brand/devices";
import { Reveal } from "@/components/motion/reveal";
import { Parallax } from "@/components/motion/parallax";
import { EmptyState, Spinner } from "@/components/brand/ui";
import { LocaleSwitcher } from "@/features/shell/locale-switcher";
import { LegalFooterNav } from "@/components/brand/legal-footer-nav";
import { Button } from "@/components/ui/button";
import { TrustBadge } from "@/components/brand/trust-badge";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Menu,
  ShieldCheck,
  Award,
  Users,
  Clock,
  LayoutDashboard,
  ContactRound,
  Workflow,
  Radio,
  ScanLine,
  PlugZap,
  Bot,
} from "lucide-react";
import {
  FOUNDER,
  MEMBERSHIPS,
  OFFICES,
  REGULATORY_NOTE,
  TESTIMONIALS,
} from "@/lib/domain/brand";
import { catalogueForSeedKey } from "@/lib/domain/programme-alias";

/**
 * Hero copy is the one place brand DATA and translation still meet: the admin
 * writes free-form hero text in Settings → Brand, while every locale carries a
 * translated default. This picks between them per field.
 *
 * `loadBrandSettings` deep-merges the DB row over canon, so a field the admin
 * never touched comes back byte-identical to canon — canon therefore doubles as
 * the "unset" sentinel. A value that is non-empty AND differs from canon is a
 * real admin override and renders verbatim; anything else falls back to the
 * localized default. Without the canon comparison a canon value would always
 * beat i18n and the hero would lose its translations.
 */
function heroValue(override: string, fallback: string, canon: string): string {
  const v = override.trim();
  return v.length > 0 && v !== canon.trim() ? override : fallback;
}

/**
 * The testimonial band is split so a real, concise client voice is set large
 * as a pull-quote while the full-length accounts sit in the practice list
 * below — no quote is invented and none is printed twice. In the brand module
 * the first entry is deliberately the concise one; the rest are the
 * full-length accounts.
 */
const FEATURED_VOICE = TESTIMONIALS[0];
const REMAINING_VOICES = TESTIMONIALS.slice(1);

const OFFERINGS: Array<{
  lineKey: StringKey;
  titleKey: StringKey;
  descKey: StringKey;
}> = [
  {
    lineKey: "landing.offerings.citizenship.line",
    titleKey: "landing.offerings.citizenship.title",
    descKey: "landing.offerings.citizenship.desc",
  },
  {
    lineKey: "landing.offerings.residence.line",
    titleKey: "landing.offerings.residence.title",
    descKey: "landing.offerings.residence.desc",
  },
  {
    lineKey: "landing.offerings.realestate.line",
    titleKey: "landing.offerings.realestate.title",
    descKey: "landing.offerings.realestate.desc",
  },
  {
    lineKey: "landing.offerings.funds.line",
    titleKey: "landing.offerings.funds.title",
    descKey: "landing.offerings.funds.desc",
  },
  {
    lineKey: "landing.offerings.businessSetup.line",
    titleKey: "landing.offerings.businessSetup.title",
    descKey: "landing.offerings.businessSetup.desc",
  },
  {
    lineKey: "landing.offerings.businessDev.line",
    titleKey: "landing.offerings.businessDev.title",
    descKey: "landing.offerings.businessDev.desc",
  },
  {
    lineKey: "landing.offerings.bankAccount.line",
    titleKey: "landing.offerings.bankAccount.title",
    descKey: "landing.offerings.bankAccount.desc",
  },
  {
    lineKey: "landing.offerings.taxOptimization.line",
    titleKey: "landing.offerings.taxOptimization.title",
    descKey: "landing.offerings.taxOptimization.desc",
  },
];

/** The card shape every renderer below expects, fallback or live. */
type Card = {
  key: string;
  label: string;
  country: string;
  kind: "RESIDENCE" | "CITIZENSHIP";
  summary: string;
  minInvestment: number;
  currency: string;
  processingWeeks: number;
  authority: string;
};

/**
 * Fallback catalogue if /api/catalog is unreachable. Deliberately a card-shaped
 * projection of the SAME programmes the API serves, so a network blip degrades
 * to slightly stale copy rather than to a different-looking page.
 */
const FALLBACK_PROGRAMMES: Card[] = [
  {
    key: "MT_CITIZENSHIP",
    label: "Malta — Citizenship by Naturalisation",
    country: "Malta",
    kind: "CITIZENSHIP",
    summary:
      "Naturalisation for exceptional services by direct investment, subject to the current regulatory framework.",
    minInvestment: 690_000,
    currency: "EUR",
    processingWeeks: 36,
    authority: "Community Malta Agency",
  },
  {
    key: "KN_CITIZENSHIP",
    label: "St Kitts & Nevis — Citizenship by Investment",
    country: "St Kitts & Nevis",
    kind: "CITIZENSHIP",
    summary:
      "The longest-established citizenship programme — contribution or approved real estate.",
    minInvestment: 250_000,
    currency: "USD",
    processingWeeks: 24,
    authority: "St Kitts CIU",
  },
  {
    key: "PT_GOLDEN",
    label: "Portugal — Residence by Investment",
    country: "Portugal",
    kind: "RESIDENCE",
    summary:
      "Residence through qualifying funds or business investment — minimal stay, family included.",
    minInvestment: 500_000,
    currency: "EUR",
    processingWeeks: 24,
    authority: "AIMA",
  },
  {
    key: "DE_RESIDENCE_BUSINESS",
    label: "Germany — Residence by Business Investment",
    country: "Germany",
    kind: "RESIDENCE",
    summary:
      "Residence tied to a viable German operating entity; the business plan is decisive.",
    minInvestment: 250_000,
    currency: "EUR",
    processingWeeks: 16,
    authority: "Ausländerbehörde",
  },
  {
    key: "AE_GOLDEN",
    label: "UAE — Golden Visa & Company Set Up",
    country: "United Arab Emirates",
    kind: "RESIDENCE",
    summary:
      "Long-term renewable residence for investors and founders, with free-zone formation in-house.",
    minInvestment: 545_000,
    currency: "AED",
    processingWeeks: 8,
    authority: "ICP",
  },
  {
    key: "US_EB5",
    label: "USA — EB-5 Immigrant Investor Residence",
    country: "USA",
    kind: "RESIDENCE",
    summary:
      "Conditional green card through qualifying job-creating investment — family included.",
    minInvestment: 800_000,
    currency: "USD",
    processingWeeks: 96,
    authority: "USCIS",
  },
];

/** Inline style carrying a CSS custom property for staggered entrances. */
const enterDelay = (ms: number): React.CSSProperties =>
  ({ "--enter-delay": `${ms}ms` } as React.CSSProperties);

/**
 * The public section map — one list consumed by the desktop nav, the mobile
 * drawer and the footer, so a destination is declared once.
 */
/**
 * The section list lives ONLY in the menu drawer (see the header below): the
 * top bar keeps the brand, Sign in and Start my application at every breakpoint,
 * so there is no desktop-only inline nav to keep in sync with the phone one.
 */
const NAV_LINKS: Array<{ href: string; key: StringKey }> = [
  { href: "#offerings", key: "landing.section.services" },
  { href: "#programmes", key: "landing.nav.programmes" },
  { href: "#platform", key: "landing.nav.platform" },
  { href: "#practice", key: "landing.nav.practice" },
  { href: "/journal", key: "landing.nav.journal" },
];

/**
 * The two doors into the product. Both lead to the same sign-in (one
 * credential, one session) — the audience is what differs, and it decides which
 * workspace the visitor lands in and which copy they read on the way there.
 */
type PlatformDoor = {
  key: "client" | "staff";
  eyebrowKey: StringKey;
  titleKey: StringKey;
  bodyKey: StringKey;
  ctaKey: StringKey;
};

const PLATFORM_DOORS: readonly PlatformDoor[] = [
  {
    key: "client",
    eyebrowKey: "landing.platform.client.eyebrow",
    titleKey: "landing.platform.client.title",
    bodyKey: "landing.platform.client.body",
    ctaKey: "landing.platform.client.cta",
  },
  {
    key: "staff",
    eyebrowKey: "landing.platform.staff.eyebrow",
    titleKey: "landing.platform.staff.title",
    bodyKey: "landing.platform.staff.body",
    ctaKey: "landing.platform.staff.cta",
  },
];

/**
 * The surface inventory. Names reuse the in-app navigation labels
 * (src/lib/nav.ts) so the public page and the console can never call the same
 * surface two different things; only the one-line descriptions are new copy.
 */
const PLATFORM_SURFACES: ReadonlyArray<{
  key: string;
  nameKey: StringKey;
  descKey: StringKey;
  icon: typeof LayoutDashboard;
}> = [
  { key: "portal", nameKey: "nav.caseDashboard", descKey: "landing.platform.surfaces.portal.desc", icon: ShieldCheck },
  { key: "caseDesk", nameKey: "nav.caseQueue", descKey: "landing.platform.surfaces.caseDesk.desc", icon: LayoutDashboard },
  { key: "crm", nameKey: "nav.crm", descKey: "landing.platform.surfaces.crm.desc", icon: ContactRound },
  { key: "studio", nameKey: "nav.studio", descKey: "landing.platform.surfaces.studio.desc", icon: Workflow },
  { key: "automation", nameKey: "nav.automation", descKey: "landing.platform.surfaces.automation.desc", icon: Radio },
  { key: "kyc", nameKey: "nav.kycChecks", descKey: "landing.platform.surfaces.kyc.desc", icon: ScanLine },
  { key: "integrations", nameKey: "admin.integrations", descKey: "landing.platform.surfaces.integrations.desc", icon: PlugZap },
  { key: "agent", nameKey: "nav.mcp", descKey: "landing.platform.surfaces.agent.desc", icon: Bot },
];

/**
 * The floating brand panel over the hero pattern — the brand book cover: the
 * mark, the wordmark, and the standing tagline ("Citizenship & Residence by
 * Investment") that states what the firm actually does.
 *
 * The SLOGAN ("Let's create tomorrow") is not repeated here; it lives in the
 * ring beside the panel. The tagline is a different line and belongs with the
 * mark — dropping it stripped the panel down to a bare wordmark.
 */
function HeroLockup() {
  return (
    <div
      className="enter panel-float gold-hairline-top flex w-[min(85vw,27rem)] flex-col items-center gap-4 p-6 sm:gap-6 sm:p-8 lg:p-10"
      style={enterDelay(240)}
    >
      {/* The mark is sized against the wordmark, not for its own sake. The
          brand book's lockup runs the mark at 0.26x the wordmark's width
          (sampled from the reference artwork: a 148px mark over a 565px
          wordmark). Ours was 147px over 260px -- 1.77 -- which read as a large
          seal with a small label beneath it. These sizes restore the book's
          proportion inside the existing panel. CSS size overrides the SVG's
          width/height attributes, so one element still serves every screen. */}
      <PassportSeal
        size={128}
        animated
        className="h-16 w-16 sm:h-20 sm:w-20 lg:h-20 lg:w-20"
      />
      <Wordmark
        size="lg"
        className="text-center [&>div:last-child]:block lg:hidden"
      />
      <Wordmark size="xl" className="hidden text-center lg:block" />
    </div>
  );
}

/**
 * ConsultationForm — the landing page's real intake. Posts to the PUBLIC
 * /api/enquiries endpoint (rate-limited, normalised, stored as a Lead) and
 * replaces what used to be a dead-end button into the Journal.
 */
function ConsultationForm({ programmes }: { programmes: Card[] }) {
  const { t } = useI18n();
  const [values, setValues] = useState({
    name: "",
    email: "",
    phone: "",
    programmeKey: "",
    message: "",
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  const set =
    (k: keyof typeof values) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >
    ) =>
      setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!values.name.trim() || !values.email.trim()) {
      setError(t("landing.consultation.formRequired"));
      return;
    }
    if (!consent) {
      setError(t("legal.consentRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.submitEnquiry({
        name: values.name,
        email: values.email,
        phone: values.phone || undefined,
        programmeKey: values.programmeKey || undefined,
        message: values.message || undefined,
      });
      setDone(res.reference);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-none border border-[#F5F1EA]/70 bg-white/[0.04] px-3 py-2.5 text-sm text-[#F5F1EA] placeholder:text-[#F5F1EA]/40 outline-none transition-[border-color,box-shadow] duration-200 hover:border-[#F5F1EA]/85 focus-visible:border-gold focus-visible:shadow-[0_0_0_3px_rgba(199,157,82,0.22)] aria-[invalid=true]:border-coral aria-[invalid=true]:focus-visible:border-coral aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_rgba(242,132,130,0.22)]";
  const labelClass = "mb-1.5 block eyebrow eyebrow-tight text-gold-ink";

  // Validation timing: never shout while the visitor is mid-word. A field is
  // only marked invalid once it has been BLURRED and is still empty/invalid, so
  // the first keystroke never turns the form red under the cursor.
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean }>(
    {}
  );
  const nameInvalid = Boolean(touched.name && !values.name.trim());
  const emailInvalid = Boolean(touched.email && !values.email.trim());
  const markTouched = (k: "name" | "email") => () =>
    setTouched((v) => ({ ...v, [k]: true }));

  if (done) {
    return (
      <div
        className="gold-hairline-top fade-rise relative border border-gold/40 bg-gold/[0.07] p-7 text-[#F5F1EA]"
        role="status"
        aria-live="polite"
      >
        <PassportSeal size={48} />
        <p className="mt-4 eyebrow text-gold-ink">
          {t("landing.consultation.received")}
        </p>
        <p className="mt-3 text-sm leading-relaxed text-[#F5F1EA]/85">
          {t("landing.consultation.receivedBody")}
        </p>
        <p className="mt-4 inline-flex items-center gap-2 border border-gold/40 bg-gold/10 px-3 py-1.5 font-mono text-xs text-gold-ink">
          {done}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-3 border border-[#F5F1EA]/15 bg-white/[0.03] p-6 md:p-7"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t("landing.consultation.name")} *</span>
          <input
            className={field}
            value={values.name}
            onChange={set("name")}
            onBlur={markTouched("name")}
            autoComplete="name"
            required
            aria-invalid={nameInvalid || undefined}
          />
          {nameInvalid && (
            <span className="mt-1 block text-[11px] text-limestone-ink">
              {t("common.required")}
            </span>
          )}
        </label>
        <label className="block">
          <span className={labelClass}>
            {t("landing.consultation.email")} *
          </span>
          <input
            className={field}
            type="email"
            value={values.email}
            onChange={set("email")}
            onBlur={markTouched("email")}
            autoComplete="email"
            required
            aria-invalid={emailInvalid || undefined}
          />
          {emailInvalid && (
            <span className="mt-1 block text-[11px] text-limestone-ink">
              {t("common.required")}
            </span>
          )}
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>{t("landing.consultation.phone")}</span>
          <input
            className={field}
            type="tel"
            value={values.phone}
            onChange={set("phone")}
            autoComplete="tel"
          />
        </label>
        <label className="block">
          <span className={labelClass}>
            {t("landing.consultation.interest")}
          </span>
          <select
            className={field}
            value={values.programmeKey}
            onChange={set("programmeKey")}
          >
            <option value="" className="text-cobble-ink">
              {t("landing.consultation.interestAny")}
            </option>
            {programmes.map((p) => (
              <option key={p.key} value={p.key} className="text-cobble-ink">
                {p.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={labelClass}>{t("landing.consultation.notes")}</span>
        <textarea
          className={`${field} min-h-[92px]`}
          value={values.message}
          onChange={set("message")}
          rows={3}
        />
      </label>
      <label className="flex items-start gap-2.5 pt-1">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded-none accent-[#B08C52] outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-cobble"
          required
        />
        <span className="text-[11px] leading-relaxed text-[#F5F1EA]/80">
          {t("legal.consentLead")}{" "}
          <a
            href="/legal/privacy-policy"
            className="link-sweep text-gold-ink hover:text-limestone-ink"
          >
            {t("legal.privacyPolicy")}
          </a>
        </span>
      </label>
      {error && (
        <p
          role="alert"
          aria-live="assertive"
          className="border-l-2 border-coral bg-coral/10 px-3 py-2 text-sm text-[#F5F1EA]"
        >
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className="focus-gold w-full gap-2 rounded-none bg-gold py-6 text-sm uppercase tracking-[0.18em] text-cobble-ink transition-colors duration-200 hover:bg-limestone disabled:cursor-not-allowed"
      >
        {busy && <Spinner className="border-cobble border-t-transparent" />}
        {busy
          ? t("landing.consultation.sending")
          : t("landing.consultation.submit")}
      </Button>
    </form>
  );
}

export function Landing() {
  const setView = useApp((s) => s.setView);
  const setLoginAudience = useApp((s) => s.setLoginAudience);
  const { t } = useI18n();
  // The shared brand store — one /api/brand fetch for the whole page (the
  // contact line, slogan and hero all read from it, canon until it resolves).
  const brand = useBrand();
  // Contact line is data, not translation: assembled from the live brand.
  const contactLine = `${brand.contact.site} · ${brand.contact.city} · ${brand.contact.email} · ${brand.contact.phone}`;
  // Hero: a Settings → Brand override wins; the localized default is the fallback.
  const heroEyebrow = heroValue(
    brand.hero.eyebrow,
    t("landing.hero.eyebrow"),
    CANON_BRAND.hero.eyebrow
  );
  const heroHeadline = heroValue(
    brand.hero.headline,
    t("landing.hero.title"),
    CANON_BRAND.hero.headline
  );
  const heroSub = heroValue(
    brand.hero.subtext,
    t("landing.hero.sub"),
    CANON_BRAND.hero.subtext
  );
  const heroCta = heroValue(
    brand.hero.ctaPrimary,
    t("landing.hero.cta"),
    CANON_BRAND.hero.ctaPrimary
  );
  const heroCtaSecondary = heroValue(
    brand.hero.ctaSecondary,
    t("landing.hero.journalCta"),
    CANON_BRAND.hero.ctaSecondary
  );
  const [programmes, setProgrammes] = useState<Card[]>(FALLBACK_PROGRAMMES);
  // True until /api/catalog resolves and replaces the fallback projection. The
  // page renders immediately from the canon fallback (no layout shift, no blank
  // band), so this only drives a quiet "refreshing" shimmer on the cards.
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [family, setFamily] = useState<"ALL" | "CITIZENSHIP" | "RESIDENCE">(
    "ALL"
  );
  // Mobile section menu — the primary bar hides the nav below lg.
  const [menuOpen, setMenuOpen] = useState(false);

  // Live catalogue — the page always shows the real, current programmes.
  useEffect(() => {
    let alive = true;
    // Fields are defaulted at the boundary: the API row is DB-backed, so an
    // unset column must degrade to a sane card value, never to `null` in the UI.
    api
      .catalog()
      .then(({ programmes: rows }) => {
        if (!alive || rows.length === 0) return;
        setProgrammes(
          rows.map((r) => ({
            key: r.key,
            label: r.label,
            country: r.country,
            kind: r.kind ?? "RESIDENCE",
            summary: r.summary ?? "",
            minInvestment: r.minInvestment ?? 0,
            currency: r.currency ?? "EUR",
            processingWeeks: r.processingWeeks ?? 0,
            authority: r.authority ?? "",
          }))
        );
      })
      .catch(() => {
        /* keep the fallback catalogue */
      })
      .finally(() => {
        if (alive) setCatalogueLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const visible =
    family === "ALL" ? programmes : programmes.filter((p) => p.kind === family);
  const counts = {
    CITIZENSHIP: programmes.filter((p) => p.kind === "CITIZENSHIP").length,
    RESIDENCE: programmes.filter((p) => p.kind === "RESIDENCE").length,
  };

  // Sticky-header elevation. At the top the header is flush with the page (as
  // the print collateral would be); once the page scrolls it lifts onto a
  // hairline + whisper of shadow so the chrome reads as a layer, not a band.
  const scrolled = useScrolled(8);
  // Reading progress 0→1, drawn as a gold hairline under the header.
  const progress = useScrollProgress();

  return (
    /* `data-surface="editorial"` — the public skin of the consolidated product
       (src/lib/theme/index.ts). The staff console and the applicant portal are
       the same brand with a different rhythm. */
    <main className="force-light min-h-screen flex flex-col bg-background" data-surface="editorial">
      {/* Organization structured data — helps search engines describe the firm.
          Served as an external file (public/landing-structured-data.json) rather
          than an inline <script> — one less inline script in the page.

          `@next/next/no-sync-scripts` flags any <script src> without async/defer,
          but this is a non-executable JSON-LD data block, not a render-blocking
          script, so the rule is overridden here on purpose. */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts -- JSON-LD data block, not an executable script */}
      <script src="/landing-structured-data.json" type="application/ld+json" />

      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded focus:bg-cobble focus:px-4 focus:py-2 focus:text-sm focus:text-[#F5F1EA]"
      >
        {t("common.skipToContent")}
      </a>

      {/* App-like sticky header — a slim utility bar over a taller primary bar,
          translucent and blurred, keyboard-reachable, with a gold reading
          progress hairline along its lower edge. */}
      <header
        className={cn(
          "sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md transition-[border-color,box-shadow] duration-300 supports-[backdrop-filter]:bg-background/75",
          scrolled
            ? "border-border shadow-[0_1px_0_rgba(18,40,58,0.06),0_18px_40px_-28px_rgba(18,40,58,0.5)]"
            : "border-transparent"
        )}
      >
        {/* Quiet masthead: the reference uses one generous paper bar, one
            lockup, and one decisive action. Product navigation remains in the
            drawer so the entrance is editorial instead of dashboard-like. */}
        {/* Same container as every section below: one left rail for the whole page. */}
        <div className="mx-auto flex h-[92px] max-w-6xl items-center justify-between gap-4 px-5 md:px-8">
          {/* Brand mark — always returns to the top of the public home. */}
          <button
            type="button"
            onClick={() => {
              setView("landing");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="-ml-1 flex shrink-0 items-center gap-3 rounded-sm px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            aria-label={`${brand.wordmark.title} — home`}
          >
            {/* Seal alone below `sm`: the wordmark is 195px wide, which at 320px
                left no room for the two calls to action and the menu trigger. */}
            <PassportSeal
              size={56}
              className="h-11 w-11 shrink-0 md:h-14 md:w-14"
            />
            <Wordmark size="md" className="hidden sm:block" />
          </button>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Button
              variant="outline"
              className="inline-flex rounded-none border-cobble px-3 py-2 text-[11px] font-medium tracking-[0.04em] text-cobble-ink transition-colors duration-200 hover:bg-cobble hover:text-[#F5F1EA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-5 sm:py-2.5 sm:text-[13px] sm:tracking-[0.02em]"
              onClick={() => {
                // Client door: the applicant's portal.
                setLoginAudience("client");
                setView("login");
              }}
            >
              {t("nav.signIn")}
            </Button>
            {/* Staff door — the console. Desktop-only: the masthead keeps the
                brand, one sign-in and one start action on a phone, and the
                drawer carries this link at every width. */}
            <Button
              variant="ghost"
              className="hidden rounded-none px-3 py-2 text-[12px] font-medium tracking-[0.04em] text-iron-ink transition-colors duration-200 hover:bg-muted hover:text-cobble-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background md:inline-flex"
              onClick={() => {
                setLoginAudience("staff");
                setView("login");
              }}
            >
              {t("landing.nav.workspace")}
            </Button>
            <Button
              className="cta inline-flex rounded-none bg-gold px-3 py-2 text-[11px] font-medium tracking-[0.04em] text-cobble-ink transition-colors duration-200 hover:bg-limestone focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-5 sm:py-2.5 sm:text-[13px] sm:tracking-[0.02em]"
              onClick={() => setView("guided")}
            >
              {/* The masthead stays short and decisive at every width. The
                  guided intake keeps the full application wording inside the
                  journey where there is room to explain it. */}
              <span>{t("landing.hero.ctaShort")}</span>
            </Button>
            {/* The section list lives only in the drawer, so this trigger is the
                public site's only navigation and must exist at every width. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMenuOpen(true)}
              className="min-h-11 min-w-11 text-cobble-ink hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
              aria-label={t("landing.nav.menu")}
              aria-expanded={menuOpen}
            >
              <Menu className="h-5 w-5" aria-hidden />
            </Button>
          </div>
        </div>

        {/* Reading progress — a gold hairline that fills as the page is read. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-gold/90"
          style={{ transform: `scaleX(${progress})` }}
        />
      </header>

      {/* Mobile section menu — a right-hand sheet so the nav is never lost on a
          phone. Vaul owns the overlay, focus trap and Escape handling. */}
      <Drawer open={menuOpen} onOpenChange={setMenuOpen} direction="right">
        <DrawerContent className="bg-background">
          <DrawerHeader className="border-b border-border/60 pb-4">
            <DrawerTitle className="font-editorial text-xl text-cobble-ink">
              {t("common.appName")}
            </DrawerTitle>
            <DrawerDescription className="text-xs">
              {t("landing.utility.tagline")}
            </DrawerDescription>
          </DrawerHeader>
          <nav aria-label="Sections" className="flex flex-col gap-1 px-4 py-5">
            {NAV_LINKS.map((l) => (
              <a
                key={l.key}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="group flex items-center justify-between rounded-sm px-3 py-3.5 text-sm font-medium uppercase tracking-[0.16em] text-iron-ink transition-colors duration-200 hover:bg-muted hover:text-cobble-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
              >
                {t(l.key)}
                <span
                  aria-hidden="true"
                  className="h-[1.5px] w-5 origin-left scale-x-0 bg-gold transition-transform duration-300 group-hover:scale-x-100"
                />
              </a>
            ))}
          </nav>
          <div className="mt-auto space-y-2 border-t border-border/60 p-4">
            <Button
              className="cta w-full rounded-none bg-gold py-6 text-sm tracking-[0.16em] text-cobble-ink hover:bg-limestone"
              onClick={() => {
                setMenuOpen(false);
                setView("guided");
              }}
            >
              {t("landing.hero.ctaShort")}
            </Button>
            <Button
              variant="outline"
              className="w-full rounded-none border-cobble py-6 text-sm tracking-[0.16em] text-cobble-ink hover:bg-cobble hover:text-[#F5F1EA]"
              onClick={() => {
                setMenuOpen(false);
                setLoginAudience("client");
                setView("login");
              }}
            >
              {t("nav.signIn")}
            </Button>
            <Button
              variant="ghost"
              className="w-full rounded-none py-6 text-sm tracking-[0.16em] text-iron-ink hover:bg-muted hover:text-cobble-ink"
              onClick={() => { setMenuOpen(false); setLoginAudience("staff"); setView("login"); }}
            >
              {t("landing.nav.workspace")}
            </Button>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Hero */}
      <section id="content" className="relative overflow-hidden scroll-mt-16">
        {/* The hero shares the page's one container, so its copy sits on the same
            left rail as the header, every section and the footer. It previously
            hung on a full-bleed grid with `lg:pl-24`, which put the headline
            96px from the edge while the header sat at 112 and the sections at
            176 — three rails at desktop, one at mobile. */}
        <div className="mx-auto w-full max-w-6xl px-5 md:px-8">
          <div className="grid lg:grid-cols-2 min-h-[400px] lg:min-h-[560px]">
            <div className="relative flex flex-col justify-center py-16 lg:py-20">
              <p
                className="enter eyebrow eyebrow-tight mb-4 text-gold-ink"
                style={enterDelay(40)}
              >
                {heroEyebrow}
              </p>
              <h1
                className="enter max-w-[15ch] font-editorial text-[clamp(3.4rem,6vw,5.8rem)] leading-[0.96] tracking-[-0.035em] text-cobble-ink"
                style={enterDelay(90)}
              >
                {heroHeadline}
              </h1>
              <div
                className="enter-rule h-[2px] w-24 bg-gold my-8"
                style={enterDelay(200)}
              />
              <p
                className="enter max-w-[34rem] text-[1.05rem] leading-[1.7] text-iron-ink"
                style={enterDelay(280)}
              >
                {heroSub}
              </p>
              <div
                                            className="enter mt-10 flex flex-col sm:flex-row flex-wrap gap-4"
                                            style={enterDelay(360)}
                                          >
                                            <Button
                                              className="cta rounded-none bg-cobble px-8 py-6 sm:px-10 sm:py-7 text-sm sm:text-base tracking-[0.16em] font-semibold text-[#F5F1EA] transition-all duration-200 hover:bg-[#1d3b53] hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background min-h-[48px] sm:min-h-[52px]"
                                              onClick={() => setView("guided")}
                                            >
                                              {heroCta}
                                            </Button>
                                            <Button
                                              variant="outline"
                                              className="rounded-none border-2 border-gold/60 bg-transparent px-8 py-6 sm:px-10 sm:py-7 text-sm sm:text-base tracking-[0.18em] font-medium uppercase text-gold-ink transition-all duration-200 hover:bg-gold/10 hover:border-gold hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background min-h-[48px] sm:min-h-[52px]"
                                              onClick={() => setView("pages-explore")}
                                            >
                                              {heroCtaSecondary} <span aria-hidden="true">→</span>
                                            </Button>
                                          </div>

              {/* Trust signals */}
              <div
                className="enter mt-12 flex flex-wrap items-center gap-6 text-sm text-muted-foreground"
                style={enterDelay(440)}
              >
                <TrustBadge
                  variant="compact"
                  icon={ShieldCheck}
                  title={t("landing.hero.trust.trusted")}
                />
                <TrustBadge
                  variant="compact"
                  icon={Award}
                  title={t("landing.hero.trust.awarded")}
                />
                <TrustBadge
                  variant="compact"
                  icon={Users}
                  title={t("landing.hero.trust.families")}
                />
              </div>
            </div>

            {/* Visual band — the official graphic device at EVERY breakpoint:
              the gold lattice pattern from the Visual Language v2 PDF replaces
              the former hero image, keeping the entrance lightweight, exact to
              the brand system, and stable at every aspect ratio. */}
            <div className="relative min-h-[380px] overflow-hidden bg-[#F5F1EA] sm:min-h-[500px] lg:min-h-0">
              <LatticePattern id="cl-hero-lattice" cell={132} opacity={0.16} />
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-background/35 via-transparent to-gold/[0.04]"
                aria-hidden="true"
              />
              <div
                className="absolute inset-y-0 right-0 w-[32%] bg-cobble sm:w-[30%] lg:w-[31%]"
                aria-hidden="true"
              />
              {/* The reference places the slogan stamp low in the dark signature
                rail, not over the lattice. Keep it visible without letting it
                collide with the floating lockup at any breakpoint. */}
              <Parallax
                as="div"
                speed={-0.05}
                clamp={40}
                className="pointer-events-none absolute bottom-4 right-[1%] z-10 sm:bottom-6 lg:bottom-5"
              >
                <SloganRing
                  size={132}
                  color={brand.tokens.gold}
                  speed={34}
                  className="h-24 w-24 sm:h-28 sm:w-28 lg:h-[132px] lg:w-[132px]"
                />
              </Parallax>
              <div className="absolute inset-0 flex items-center justify-center p-6 sm:p-8 lg:justify-end lg:pr-[12%]">
                <HeroLockup />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Offerings — the four service pillars, as on the original site */}
      <section
        id="offerings"
        aria-labelledby="landing-offerings-title"
        className="border-t border-border/60 bg-background scroll-mt-16"
      >
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-16 md:py-20">
          <Reveal className="flex items-center gap-3">
            <span aria-hidden="true" className="h-[2px] w-8 bg-gold" />
            <p className="eyebrow text-iron-ink">
              {t("landing.offerings.eyebrow")}
            </p>
          </Reveal>
          <Reveal
            as="h2"
            delay={80}
            id="landing-offerings-title"
            className="mt-5 font-editorial type-h2 text-cobble-ink max-w-2xl"
          >
            {t("landing.offerings.title")}
          </Reveal>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {OFFERINGS.map((o, i) => (
              // Same card treatment as the programme strip below: serif lead
              // line, cobble serif title, iron body, hairline rule → gold.
              <Reveal
                as="article"
                key={o.titleKey}
                delay={i * 80}
                className="relative"
              >
                <p className="font-editorial text-sm text-iron-ink">
                  {t(o.lineKey)}
                </p>
                <h3 className="mt-3 font-editorial type-h3 text-cobble-ink">
                  {t(o.titleKey)}
                </h3>
                <p className="mt-2 text-sm text-iron-ink leading-relaxed">
                  {t(o.descKey)}
                </p>
                <div
                  className="mt-3 h-[1px] w-10 bg-limestone"
                  aria-hidden="true"
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* One platform — the merged front door. Everything above is the firm's
          story; this section is the product itself: the two doors (applicant /
          desk) and the surfaces behind them, named exactly as they are named
          inside the app. */}
      <section
        id="platform"
        aria-labelledby="landing-platform-title"
        className="border-t border-border/60 bg-muted/40 scroll-mt-16"
      >
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-16 md:py-20">
          <Reveal className="flex items-center gap-3">
            <span aria-hidden="true" className="h-[2px] w-8 bg-gold" />
            <p className="eyebrow text-iron-ink">{t("landing.platform.eyebrow")}</p>
          </Reveal>
          <Reveal
            as="h2"
            delay={80}
            id="landing-platform-title"
            className="mt-5 font-editorial type-h2 text-cobble-ink max-w-3xl"
          >
            {t("landing.platform.title")}
          </Reveal>
          <Reveal as="p" delay={120} className="mt-4 max-w-[64ch] text-[15px] leading-relaxed text-iron-ink">
            {t("landing.platform.lead")}
          </Reveal>

          {/* Two doors. Same credentials, same brand — different room. */}
          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            {PLATFORM_DOORS.map((door, i) => (
              <Reveal
                as="article"
                key={door.key}
                delay={i * 100}
                className="panel card-lift flex flex-col p-6 md:p-8"
              >
                <p className="eyebrow eyebrow-tight text-gold-ink">{t(door.eyebrowKey)}</p>
                <h3 className="mt-3 font-editorial type-h3 text-cobble-ink">{t(door.titleKey)}</h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-iron-ink">{t(door.bodyKey)}</p>
                <Button
                  variant={door.key === "client" ? "outline" : "default"}
                  className={cn(
                    "mt-6 w-fit rounded-none px-5 py-5 text-[13px] tracking-[0.02em] transition-colors duration-200",
                    door.key === "client"
                      ? "border-cobble text-cobble-ink hover:bg-cobble hover:text-[#F5F1EA]"
                      : "cta bg-gold text-cobble-ink hover:bg-limestone",
                  )}
                  onClick={() => {
                    setLoginAudience(door.key);
                    setView("login");
                  }}
                >
                  {t(door.ctaKey)}
                </Button>
              </Reveal>
            ))}
          </div>

          {/* The inventory — every surface, under its in-app name. */}
          <Reveal as="h3" delay={60} className="mt-16 eyebrow eyebrow-tight text-iron-ink">
            {t("landing.platform.surfaces.title")}
          </Reveal>
          <ul className="mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {PLATFORM_SURFACES.map((s, i) => (
              <Reveal as="li" key={s.key} delay={i * 60} className="flex gap-3">
                <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
                <div>
                  <p className="font-editorial text-[15px] text-cobble-ink">{t(s.nameKey)}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{t(s.descKey)}</p>
                </div>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* Programme catalogue — every live programme, filterable by family */}
      <section
        id="programmes"
        aria-labelledby="landing-programmes-title"
        className="border-t border-border/60 bg-card scroll-mt-16"
      >
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-16 md:py-20">
          <Reveal className="flex items-center gap-3">
            <span aria-hidden="true" className="h-[2px] w-8 bg-gold" />
            <p className="eyebrow text-iron-ink">
              {t("landing.programmes.eyebrow")}
            </p>
          </Reveal>
          <Reveal
            as="h2"
            delay={80}
            id="landing-programmes-title"
            className="mt-5 font-editorial type-h2 text-cobble-ink max-w-2xl"
          >
            {t("landing.programmes.title")}
          </Reveal>
          <Reveal
            as="p"
            delay={140}
            className="mt-4 measure text-base leading-relaxed text-iron-ink"
          >
            {t("landing.programmes.body")}
          </Reveal>

          <Reveal
            delay={200}
            role="group"
            aria-label={t("landing.programmes.filterLabel")}
            className="mt-8 flex flex-wrap gap-3"
          >
            {(
              [
                [
                  "ALL",
                  `${t("landing.programmes.all")} (${programmes.length})`,
                ],
                [
                  "CITIZENSHIP",
                  `${t("landing.programmes.citizenship")} (${
                    counts.CITIZENSHIP
                  })`,
                ],
                [
                  "RESIDENCE",
                  `${t("landing.programmes.residence")} (${counts.RESIDENCE})`,
                ],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={family === key}
                onClick={() => setFamily(key)}
                className={cn(
                  "min-h-11 rounded-none border px-4 py-2 eyebrow eyebrow-tight transition-colors duration-200 focus-gold",
                  family === key
                    ? "border-cobble bg-cobble text-[#F5F1EA]"
                    : "border-limestone text-iron-ink hover:border-gold hover:text-gold-ink"
                )}
              >
                {label}
              </button>
            ))}
          </Reveal>

          <div
            aria-busy={catalogueLoading || undefined}
            className="mt-10 grid gap-8 md:grid-cols-2 lg:grid-cols-3"
          >
            {visible.map((p, i) => (
              <Reveal
                as="article"
                key={`${family}-${p.key}`}
                delay={i * 60}
                className="group gold-wash relative flex flex-col border-t border-limestone pt-5"
              >
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-gold-ink">
                    {p.country}
                  </p>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-gold-ink/60">
                    {p.kind}
                  </span>
                </div>
                <h3 className="mt-2 font-editorial type-h3 text-cobble-ink">
                  {p.label}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-iron-ink">
                  {p.summary}
                </p>
                {/* Key metrics */}
                <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  {p.minInvestment > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden="true">€</span>
                      {(p.minInvestment / 1000000).toFixed(
                        p.minInvestment >= 1000000 ? 1 : 2
                      )}
                      M {p.currency}
                    </span>
                  )}
                  {p.processingWeeks > 0 && (
                    <span className="flex items-center gap-1.5">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {p.processingWeeks} weeks
                    </span>
                  )}
                </div>
                {/* 44px touch target on phones (`min-h-11`), with the hover
                                hairline re-pinned just under the 11px type: `.rule-link`
                                draws its ::after 2px below the padding box, which the
                                taller box would otherwise push 15px down. `!` is required —
                                the rule lives unlayered in globals.css, and unlayered
                                declarations beat Tailwind's `@layer utilities`. */}
                <a
                  href="#consultation"
                  className="rule-link mt-4 inline-flex w-fit min-h-11 items-center gap-1 eyebrow eyebrow-tight text-cobble-ink transition-colors hover:text-gold-ink rounded-sm after:bottom-[13px]! sm:min-h-0 sm:after:-bottom-0.5!"
                >
                  {t("landing.programmes.enquire")}{" "}
                  <span aria-hidden="true">→</span>
                </a>
              </Reveal>
            ))}
          </div>
          {visible.length === 0 && (
            <EmptyState
              className="mt-10"
              title={t("landing.programmes.emptyTitle")}
              hint={t("landing.programmes.emptyBody")}
              action={
                <button
                  type="button"
                  onClick={() => setFamily("ALL")}
                  className="min-h-11 border border-cobble px-5 py-2.5 eyebrow eyebrow-tight text-cobble-ink transition-colors duration-200 hover:bg-cobble hover:text-[#F5F1EA] focus-gold"
                >
                  {t("landing.programmes.showAll")}
                </button>
              }
            />
          )}
        </div>
      </section>

      {/* Testimonial — one quiet editorial voice on the warm plaster tint */}
      <section
        id="testimonial"
        aria-labelledby="landing-testimonial-title"
        className="border-t border-border/60 bg-[#F5F1EA] scroll-mt-16"
      >
        <div className="mx-auto max-w-3xl px-5 md:px-8 py-16 md:py-20">
          <Reveal
            as="h2"
            id="landing-testimonial-title"
            className="eyebrow text-iron-ink"
          >
            {t("landing.testimonial.eyebrow")}
          </Reveal>
          <Reveal as="blockquote" variant="mask" delay={120} className="mt-6">
            <span
              aria-hidden="true"
              className="block font-editorial text-5xl leading-none text-gold-ink/50"
            >
              “
            </span>
            <p className="mt-2 font-editorial type-h2 measure text-cobble-ink">
              {FEATURED_VOICE.quote}
            </p>
            <footer className="mt-6 eyebrow eyebrow-tight text-iron-ink">
              {FEATURED_VOICE.attribution}
            </footer>
          </Reveal>
        </div>
      </section>

      {/* ── The practice: founder, membership, offices, clients ─────────────
          Everything in this band comes from `@/lib/domain/brand` — the same
          module the catalogue route serves — so a fact is stated once. */}
      <BrandBand />

      {/* Consultation CTA — cobble panel; the form lives in Lane Pages */}
      <section
        id="consultation"
        aria-labelledby="landing-consultation-title"
        className="relative overflow-hidden border-t border-border/60 bg-cobble text-[#F5F1EA] scroll-mt-16"
      >
        <div className="relative mx-auto max-w-6xl px-5 md:px-8 py-16 md:py-20">
          <Reveal className="flex items-center gap-3">
            <span aria-hidden="true" className="h-[2px] w-8 bg-gold" />
            <p className="eyebrow text-gold-ink">
              {t("landing.consultation.eyebrow")}
            </p>
          </Reveal>
          <Reveal
            as="h2"
            delay={80}
            id="landing-consultation-title"
            className="mt-5 font-editorial type-h2 max-w-2xl"
          >
            {t("landing.consultation.title")}
          </Reveal>
          <Reveal
            as="p"
            delay={140}
            className="mt-4 measure text-base leading-relaxed"
          >
            {t("landing.consultation.body")}
          </Reveal>
          {/* `grid-cols-1` is load-bearing: without a base column count the implicit
              column is `auto`, which floors at the item's min-content width. At 320px
              that pushed the consultation form 48px past its 280px parent, clipping
              its right edge. minmax(0,1fr) lets the track shrink to the container. */}
          <div className="mt-8 grid grid-cols-1 gap-10 lg:grid-cols-2">
            <ConsultationForm programmes={programmes} />
            <Reveal delay={160} className="text-sm leading-relaxed">
              <p className="eyebrow eyebrow-tight text-gold-ink">
                {t("landing.consultation.direct")}
              </p>
              <p className="mt-3">{contactLine}</p>
              <p className="mt-4 measure-tight text-[#F5F1EA]/75">
                {t("landing.consultation.discretion")}
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto max-w-6xl px-5 md:px-8 py-8 flex flex-col gap-6">
          <LegalFooterNav />
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <PassportSeal size={44} />
              <p className="text-xs text-muted-foreground">{contactLine}</p>
            </div>
            <div className="flex flex-col items-center gap-3 md:flex-row md:gap-6">
              <LocaleSwitcher tone="light" />
              <p className="text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
                {brand.slogan}
              </p>
            </div>
          </div>
        </div>
      </footer>

      {/* Quick trust indicators */}
      <section
        aria-labelledby="landing-trust-title"
        className="border-t border-border/60 bg-background py-16 md:py-20"
      >
        <div className="mx-auto max-w-6xl px-5 md:px-8">
          <Reveal className="flex items-center gap-3">
            <span aria-hidden="true" className="h-[2px] w-8 bg-gold" />
            <p className="eyebrow text-gold-ink">
              {t("landing.trust.eyebrow")}
            </p>
          </Reveal>
          <Reveal
            as="h2"
            delay={80}
            id="landing-trust-title"
            className="mt-5 font-editorial type-h2 text-cobble-ink max-w-2xl"
          >
            {t("landing.trust.title")}
          </Reveal>
          <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Keys typed as StringKey (like OFFERINGS above): a misspelled
                        key fails the build instead of rendering raw key text the
                        literal-coverage test cannot see. */}
            {(
              [
                {
                  icon: ShieldCheck,
                  title: "landing.trust.regulated.title",
                  desc: "landing.trust.regulated.desc",
                },
                {
                  icon: Award,
                  title: "landing.trust.awarded.title",
                  desc: "landing.trust.awarded.desc",
                },
                {
                  icon: Users,
                  title: "landing.trust.families.title",
                  desc: "landing.trust.families.desc",
                },
              ] as Array<{
                icon: typeof ShieldCheck;
                title: StringKey;
                desc: StringKey;
              }>
            ).map((item, i) => (
              <Reveal
                as="article"
                key={item.title}
                delay={160 + i * 80}
                className="group"
              >
                <TrustBadge
                  variant="detailed"
                  icon={item.icon}
                  title={t(item.title)}
                  description={t(item.desc)}
                />
              </Reveal>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

/**
 * The practice band — who the firm is, where it practises, and what clients
 * have said. All facts come from `@/lib/domain/brand` (the same module the
 * public catalogue route serves), so nothing here can drift from the API.
 */
function BrandBand() {
  const { t } = useI18n();
  return (
    <section
      id="practice"
      aria-labelledby="landing-practice-title"
      className="scroll-mt-16 border-t border-border/60 py-16 md:py-20"
    >
      <div className="mx-auto max-w-6xl px-5 md:px-8">
        {/* Founder */}
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
          <Reveal>
            <div className="flex items-center gap-3">
              <span aria-hidden="true" className="h-[2px] w-8 bg-gold" />
              <p className="eyebrow text-gold-ink">
                {t("landing.practice.eyebrow")}
              </p>
            </div>
            <h2
              id="landing-practice-title"
              className="mt-5 font-editorial type-h2 text-cobble-ink"
            >
              {t("landing.practice.title")}
            </h2>
            <p className="mt-4 measure text-base leading-relaxed text-iron-ink">
              {FOUNDER.story}
            </p>
            <p className="mt-4 text-sm text-iron-ink">
              <span className="text-cobble-ink font-medium">
                {FOUNDER.name}
              </span>
              {", "}
              {FOUNDER.role}
              {" · "}
              {FOUNDER.background}
            </p>
            <p className="mt-4 eyebrow eyebrow-tight text-gold-ink">
              {t("landing.practice.since", { year: FOUNDER.foundedYear })}
            </p>
          </Reveal>

          {/* Clients */}
          <Reveal delay={120}>
            <h3 className="eyebrow eyebrow-tight text-iron-ink">
              {t("landing.practice.clients")}
            </h3>
            <ul className="mt-5 space-y-5">
              {REMAINING_VOICES.map((c, i) => (
                <Reveal
                  as="li"
                  key={c.key}
                  delay={i * 90}
                  className="border-l-2 border-gold/50 pl-5"
                >
                  <blockquote className="font-editorial text-base md:text-lg leading-relaxed text-cobble-ink">
                    “{c.quote}”
                  </blockquote>
                  <p className="mt-2 eyebrow eyebrow-tight text-iron-ink">
                    {c.attribution}
                    {c.programme && (
                      <span className="text-muted-foreground normal-case tracking-normal">
                        {" "}
                        · {programmeLabel(c.programme)}
                      </span>
                    )}
                  </p>
                </Reveal>
              ))}
            </ul>
          </Reveal>
        </div>

        {/* Offices + membership */}
        <div className="mt-14 grid gap-10 border-t border-limestone pt-10 lg:grid-cols-[2fr_1fr] lg:gap-16">
          <Reveal>
            <h3 className="eyebrow eyebrow-tight text-iron-ink">
              {t("landing.practice.offices")}
            </h3>
            <ul className="mt-5 grid gap-6 sm:grid-cols-3">
              {OFFICES.map((o, i) => (
                <Reveal as="li" key={o.key} delay={i * 80}>
                  <p className="font-editorial type-h3 text-cobble-ink">
                    {o.city}
                  </p>
                  <p className="mt-1 eyebrow eyebrow-tight text-gold-ink">
                    {o.role}
                  </p>
                  <address className="mt-3 text-sm not-italic leading-relaxed text-iron-ink">
                    {o.address.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </address>
                  {/* Same 44px-on-phones treatment as the "Enquire →" link —
                      inline-flex so the box centres the number, with the
                      hairline re-pinned under the text at touch widths. */}
                  <a
                    href={`tel:${o.phoneHref}`}
                    className="rule-link mt-2 inline-flex w-fit min-h-11 items-center text-sm text-cobble-ink transition-colors duration-200 hover:text-gold-ink rounded-sm after:bottom-[10px]! sm:min-h-0 sm:after:-bottom-0.5!"
                  >
                    {o.phone}
                  </a>
                </Reveal>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120}>
            <h3 className="eyebrow eyebrow-tight text-iron-ink">
              {t("landing.practice.standards")}
            </h3>
            <ul className="mt-5 space-y-5">
              {MEMBERSHIPS.map((m) => (
                <li key={m.key}>
                  <p className="font-editorial type-h3 text-cobble-ink">
                    {m.abbr}
                  </p>
                  <p className="text-sm text-iron-ink">{m.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{m.note}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-limestone pt-4 text-[11px] leading-relaxed text-muted-foreground">
              {REGULATORY_NOTE}
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/**
 * Turn a programme key into its catalogue descriptor, falling back to the key.
 *
 * Testimonials are authored against the SEED vocabulary (`TR_CITIZENSHIP`,
 * `DE_BUSINESS`), which the catalogue spells differently (`TR_CBI`,
 * `DE_RESIDENCE_BUSINESS`). Resolve through the alias map so the credit reads
 * "Citizenship by Investment" rather than leaking a raw seed key to a client.
 */
function programmeLabel(key: string): string {
  const found = catalogueForSeedKey(key);
  if (!found) return key;
  return found.label.split(" — ").pop() ?? found.label;
}

/**
 * True once the window has scrolled past `threshold` px. Used to lift the
 * sticky header. Passive listener + rAF-coalesced state so it never competes
 * with scroll; no work is done when the value has not changed.
 */
function useScrolled(threshold: number): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setScrolled(window.scrollY > threshold);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [threshold]);
  return scrolled;
}

/**
 * Reading progress through the whole document, 0→1. Drives the gold hairline
 * under the header. Same rAF-coalesced passive-listener pattern as useScrolled.
 */
function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - doc.clientHeight);
      setProgress(Math.min(1, Math.max(0, window.scrollY / max)));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return progress;
}
