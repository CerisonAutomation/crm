"use client";
/**
 * Brand & Business — one admin surface for the firm's copy: brand (wordmark,
 * slogan, contact line), firm identity + letterhead lines, the fee schedule
 * and the letter subject / signature-role copy.
 *
 * Loads the merged brand + business settings over the canon defaults. Seven
 * sections (brand copy, landing hero, colour palette, logo, firm, fees,
 * letters), each saving ONLY its own patch (so a fee edit never clobbers a
 * letter edit). Every write is authorized (business.write, ADMIN-only) and
 * audited server-side. A shared "Reset to defaults" reverts both stores.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import {
  DEFAULT_BUSINESS,
  type BusinessFees,
  type BusinessFirm,
  type BusinessLetters,
  type LetterKind,
} from "@/lib/business/defaults";
import type { CanonBrand } from "@/lib/brand/defaults";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { TypedConfirmDialog } from "@/components/brand/typed-confirm-dialog";
import { BrandLoader, Eyebrow, SectionTitle, Spinner } from "@/components/brand/ui";
import { useI18n } from "@/lib/i18n";
import { toast } from "@/hooks/use-toast";
import { Plus, RefreshCcw, RotateCcw, Trash2 } from "lucide-react";

// ── Draft shapes (form state) ───────────────────────────────────────────────

type BrandDraft = {
  title: string; tagline: string; slogan: string;
  city: string; email: string; phone: string; site: string;
};
type FirmDraft = BusinessFirm;
type ProgrammeRow = { key: string; amount: string };
type FeesDraft = {
  currency: string;
  defaultProfessional: string;
  perProgramme: ProgrammeRow[];
  professionalLineLabel: string;
  governmentLineLabel: string;
  disbursementsLineLabel: string;
  terms: string[];
};
type LettersDraft = {
  subjects: Record<LetterKind, string>;
  issuerRoles: Record<string, string>;
};
type HeroDraft = CanonBrand["hero"];
type CoreTokenKey = "gold" | "sky" | "iron" | "limestone" | "cobble" | "paper" | "plaster";
type ChromeTokenKey = "bg" | "border" | "text" | "textDim" | "active" | "hover";
type TokensDraft = {
  gold: string; sky: string; iron: string; limestone: string;
  cobble: string; paper: string; plaster: string;
  chrome: Record<ChromeTokenKey, string>;
  secondary: string[];
};
type LogoDraft = {
  markColor: string; monogramColor: string; panelFill: string;
  /** Kept as a string so the number input stays controlled while typing. */
  panelOpacity: string;
  darkTagline: "cream" | "gold";
};

/** Letter kinds with their human labels (subject-line editors). */
const LETTER_LABELS: Array<{ key: LetterKind; label: string }> = [
  { key: "APPROVAL_IN_PRINCIPLE", label: "Approval in Principle" },
  { key: "FINAL_APPROVAL", label: "Final Approval" },
  { key: "DOCUMENT_REQUEST", label: "Document Request" },
  { key: "ENGAGEMENT_FEE_PROPOSAL", label: "Engagement & Fee Proposal" },
  { key: "PAYMENT_RECEIPT", label: "Payment Receipt" },
];

/** Signature-block role codes with human labels. */
const ISSUER_ROLES: Array<{ key: string; label: string }> = [
  { key: "RM", label: "Relationship Manager (RM)" },
  { key: "SENIOR_RM", label: "Senior RM (SENIOR_RM)" },
  { key: "ADMIN", label: "Administration (ADMIN)" },
];

/** Core palette tokens with human labels (hex editors). */
const CORE_TOKENS: Array<{ key: CoreTokenKey; label: string }> = [
  { key: "gold", label: "Gold" },
  { key: "sky", label: "Sky" },
  { key: "iron", label: "Iron" },
  { key: "limestone", label: "Limestone" },
  { key: "cobble", label: "Cobble" },
  { key: "paper", label: "Paper" },
  { key: "plaster", label: "Plaster" },
];

/** Shell chrome tones with human labels (hex editors). */
const CHROME_TOKENS: Array<{ key: ChromeTokenKey; label: string }> = [
  { key: "bg", label: "Background" },
  { key: "border", label: "Border" },
  { key: "text", label: "Text" },
  { key: "textDim", label: "Dimmed text" },
  { key: "active", label: "Active item" },
  { key: "hover", label: "Hover" },
];

/** 6-digit hex, exactly like the server-side validator (validateBrandPatch). */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const hexError = (v: string): string | undefined =>
  HEX_RE.test(v) ? undefined : "Enter a 6-digit hex colour, e.g. #B08C52";

function paletteValid(t: TokensDraft): boolean {
  return (
    CORE_TOKENS.every(({ key }) => HEX_RE.test(t[key])) &&
    CHROME_TOKENS.every(({ key }) => HEX_RE.test(t.chrome[key])) &&
    t.secondary.every((v) => HEX_RE.test(v))
  );
}

function logoValid(l: LogoDraft): boolean {
  const opacity = Number(l.panelOpacity);
  return (
    HEX_RE.test(l.markColor) &&
    HEX_RE.test(l.monogramColor) &&
    HEX_RE.test(l.panelFill) &&
    l.panelOpacity !== "" &&
    Number.isFinite(opacity) &&
    opacity >= 0 &&
    opacity <= 1
  );
}

function seedBrand(b: CanonBrand): BrandDraft {
  return {
    title: b.wordmark.title,
    tagline: b.wordmark.tagline,
    slogan: b.slogan,
    city: b.contact.city,
    email: b.contact.email,
    phone: b.contact.phone,
    site: b.contact.site,
  };
}

function seedFees(fees: BusinessFees): FeesDraft {
  return {
    currency: fees.currency,
    defaultProfessional: String(fees.defaultProfessional),
    perProgramme: Object.entries(fees.perProgramme).map(([key, amount]) => ({ key, amount: String(amount) })),
    professionalLineLabel: fees.professionalLineLabel,
    governmentLineLabel: fees.governmentLineLabel,
    disbursementsLineLabel: fees.disbursementsLineLabel,
    terms: [...fees.terms],
  };
}

function seedLetters(letters: BusinessLetters): LettersDraft {
  return {
    subjects: { ...letters.subjects },
    issuerRoles: { ...letters.issuerRoles },
  };
}

function seedHero(b: CanonBrand): HeroDraft {
  return { ...b.hero };
}

function seedTokens(b: CanonBrand): TokensDraft {
  return {
    gold: b.tokens.gold,
    sky: b.tokens.sky,
    iron: b.tokens.iron,
    limestone: b.tokens.limestone,
    cobble: b.tokens.cobble,
    paper: b.tokens.paper,
    plaster: b.tokens.plaster,
    chrome: { ...b.tokens.chrome },
    secondary: [...(b.tokens.secondary ?? [])],
  };
}

function seedLogo(b: CanonBrand): LogoDraft {
  return {
    markColor: b.logo.markColor,
    monogramColor: b.logo.monogramColor,
    panelFill: b.logo.panelFill,
    panelOpacity: String(b.logo.panelOpacity),
    darkTagline: b.logo.darkTagline,
  };
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : "Unknown error");

// ── Small local components ──────────────────────────────────────────────────

function Field({
  id, label, value, onChange, hint, multiline, rows, maxLength, error,
}: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; hint?: string; multiline?: boolean;
  rows?: number; maxLength?: number; error?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea id={id} value={value} rows={rows ?? 2} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={value} maxLength={maxLength} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
      {error ? (
        <p className="text-[11px] leading-relaxed text-danger-ink">{error}</p>
      ) : hint ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Per-section save button with its own busy state. */
function SectionSave({ onSave, label, disabled }: { onSave: () => Promise<void>; label: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      className="bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]"
      disabled={busy || disabled}
      onClick={() => { setBusy(true); void onSave().finally(() => setBusy(false)); }}
    >
      {busy && <Spinner className="mr-2 h-3 w-3" />}
      {label}
    </Button>
  );
}

function Section({
  eyebrow, title, desc, onSave, saveLabel, disabled, children,
}: {
  eyebrow: string; title: string; desc: string;
  onSave: () => Promise<void>; saveLabel: string; disabled?: boolean; children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 rounded-md border-border p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h3 className="mt-1 font-editorial text-lg text-cobble-ink">{title}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{desc}</p>
        </div>
        <SectionSave onSave={onSave} label={saveLabel} disabled={disabled} />
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </Card>
  );
}

/**
 * G21 — live preview of a generated letter inside the "Letter copy" section.
 * Rendered entirely from the CURRENT form drafts (firm + letters + brand), so
 * edits update it instantly with no server call.
 *
 * `letterhead.ts` / `letter-data.ts` are server-only (pdfkit / Prisma), so
 * their copy semantics are reproduced here from the same canon source
 * (`DEFAULT_BUSINESS`, client-safe): blank firm fields fall back to canon,
 * `{ref}` becomes a sample case reference, and the signature block prints the
 * closing → sign-off line → role label, exactly like `drawClosing`.
 */
function LetterPreview({
  firm,
  letters,
  brand,
}: {
  firm: FirmDraft;
  letters: LettersDraft;
  brand: BrandDraft;
}) {
  const { t } = useI18n();
  const fallback = (value: string, canon: string) => (value && value.trim() ? value.trim() : canon);
  const legalName = fallback(firm.legalName, DEFAULT_BUSINESS.firm.legalName);
  const place = fallback(firm.place, DEFAULT_BUSINESS.firm.place);
  const closing = fallback(firm.closing, DEFAULT_BUSINESS.firm.closing);
  const signOff = fallback(firm.signOff, DEFAULT_BUSINESS.firm.signOff);
  const issuerRole = fallback(letters.issuerRoles.RM ?? "", DEFAULT_BUSINESS.letters.issuerRoles.RM);
  const wordmark = fallback(brand.title, "CITIZEN LANE").toUpperCase();
  const subject = (letters.subjects.APPROVAL_IN_PRINCIPLE ?? "").replace(/\{ref\}/g, "CL-2026-0001");
  const contactLine = [legalName, place, brand.email, brand.phone, brand.site]
    .filter((part) => part.trim())
    .join(" · ")
    .toUpperCase();

  return (
    <div className="space-y-2">
      <Eyebrow>{t("common.preview")}</Eyebrow>
      {/* Paper sheet: warm paper ground, hairline border, thin brand rule. */}
      <div className="paper-texture rounded-sm border border-border/70 p-6 shadow-sm">
        {/* Letterhead — wordmark, tagline, gold rule, contact line. */}
        <p className="font-editorial text-sm font-semibold uppercase tracking-[0.24em] text-cobble-ink">
          {wordmark}
        </p>
        {brand.tagline.trim() && (
          <p className="mt-1 text-[9px] uppercase tracking-[0.18em] text-iron-ink/80">{brand.tagline}</p>
        )}
        <span aria-hidden="true" className="mt-3 block h-px w-full bg-gold/70" />
        <p className="mt-2 break-words text-[9px] uppercase tracking-[0.1em] text-iron-ink/80">{contactLine}</p>

        {/* Subject line — the first letter kind, `{ref}` shown with a sample case. */}
        <p className="mt-8 font-editorial text-sm font-bold uppercase tracking-[0.05em] text-cobble-ink">
          {subject}
        </p>

        {/* Salutation + body slot. */}
        <p className="mt-4 font-editorial text-sm text-iron-ink">Dear Ms. Meier,</p>
        <p className="mt-2 font-editorial text-sm leading-relaxed text-iron-ink">
          Thank you for your continued trust. We are pleased to confirm the next steps of your application and
          will contact you should we need anything further from you.
        </p>

        {/* Closing + signature block (closing, sign-off line, role — live). */}
        <p className="mt-6 font-editorial text-sm text-iron-ink">{closing}</p>
        <div className="h-10" aria-hidden="true" />
        <p className="font-editorial text-sm font-semibold text-cobble-ink">Anna Meier</p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-iron-ink/80">{signOff}</p>
        <p className="mt-0.5 font-editorial text-xs text-iron-ink">{issuerRole}</p>
      </div>
    </div>
  );
}

// ── Surface ─────────────────────────────────────────────────────────────────

export function AdminBusiness() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState<BrandDraft | null>(null);
  const [hero, setHero] = useState<HeroDraft | null>(null);
  const [tokens, setTokens] = useState<TokensDraft | null>(null);
  const [logo, setLogo] = useState<LogoDraft | null>(null);
  const [firm, setFirm] = useState<FirmDraft | null>(null);
  const [fees, setFees] = useState<FeesDraft | null>(null);
  const [letters, setLetters] = useState<LettersDraft | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [brandRes, businessRes] = await Promise.all([api.brand(), api.businessSettings()]);
      setBrand(seedBrand(brandRes.settings));
      setHero(seedHero(brandRes.settings));
      setTokens(seedTokens(brandRes.settings));
      setLogo(seedLogo(brandRes.settings));
      setFirm({ ...businessRes.settings.firm });
      setFees(seedFees(businessRes.settings.fees));
      setLetters(seedLetters(businessRes.settings.letters));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // ── section saves (each sends ONLY its own patch) ──

  async function saveBrandCopy() {
    if (!brand) return;
    try {
      const res = await api.saveBrand({
        wordmark: { title: brand.title, tagline: brand.tagline },
        slogan: brand.slogan,
        contact: { city: brand.city, email: brand.email, phone: brand.phone, site: brand.site },
      });
      setBrand(seedBrand(res.settings));
      toast({ title: "Brand copy saved", description: "Wordmark, slogan and contact line updated." });
    } catch (e) {
      toast({ title: "Save failed", description: errMsg(e), variant: "destructive" });
    }
  }

  async function saveHeroSection() {
    if (!hero) return;
    try {
      const res = await api.saveBrand({ hero: { ...hero } });
      setHero(seedHero(res.settings));
      toast({ title: "Landing hero saved", description: "Eyebrow, headline, copy and buttons updated." });
    } catch (e) {
      toast({ title: "Save failed", description: errMsg(e), variant: "destructive" });
    }
  }

  async function savePalette() {
    if (!tokens || !paletteValid(tokens)) return;
    try {
      const res = await api.saveBrand({
        tokens: {
          gold: tokens.gold,
          sky: tokens.sky,
          iron: tokens.iron,
          limestone: tokens.limestone,
          cobble: tokens.cobble,
          paper: tokens.paper,
          plaster: tokens.plaster,
          chrome: { ...tokens.chrome },
          secondary: [...tokens.secondary],
        },
      });
      setTokens(seedTokens(res.settings));
      toast({ title: "Colour palette saved", description: "Core, chrome and secondary tokens updated." });
    } catch (e) {
      toast({ title: "Save failed", description: errMsg(e), variant: "destructive" });
    }
  }

  async function saveLogoSection() {
    if (!logo || !logoValid(logo)) return;
    try {
      const res = await api.saveBrand({
        logo: {
          markColor: logo.markColor,
          monogramColor: logo.monogramColor,
          panelFill: logo.panelFill,
          panelOpacity: Number(logo.panelOpacity),
          darkTagline: logo.darkTagline,
        },
      });
      setLogo(seedLogo(res.settings));
      toast({ title: "Logo colours saved", description: "Mark, monogram and panel styling updated." });
    } catch (e) {
      toast({ title: "Save failed", description: errMsg(e), variant: "destructive" });
    }
  }

  async function saveFirm() {
    if (!firm) return;
    try {
      const res = await api.saveBusinessSettings({ firm });
      setFirm({ ...res.settings.firm });
      toast({ title: "Firm details saved", description: "Letterhead and closing copy updated." });
    } catch (e) {
      toast({ title: "Save failed", description: errMsg(e), variant: "destructive" });
    }
  }

  async function saveFees() {
    if (!fees) return;
    const perProgramme: Record<string, number> = {};
    for (const row of fees.perProgramme) {
      const key = row.key.trim();
      if (!key) continue;
      perProgramme[key] = Number(row.amount);
    }
    try {
      const res = await api.saveBusinessSettings({
        fees: {
          currency: fees.currency,
          defaultProfessional: Number(fees.defaultProfessional),
          perProgramme,
          professionalLineLabel: fees.professionalLineLabel,
          governmentLineLabel: fees.governmentLineLabel,
          disbursementsLineLabel: fees.disbursementsLineLabel,
          terms: fees.terms,
        },
      });
      setFees(seedFees(res.settings.fees));
      toast({ title: "Fee schedule saved", description: "Programme rates, labels and terms updated." });
    } catch (e) {
      toast({ title: "Save failed", description: errMsg(e), variant: "destructive" });
    }
  }

  async function saveLetters() {
    if (!letters) return;
    try {
      const res = await api.saveBusinessSettings({ letters });
      setLetters(seedLetters(res.settings.letters));
      toast({ title: "Letter copy saved", description: "Subjects and signature roles updated." });
    } catch (e) {
      toast({ title: "Save failed", description: errMsg(e), variant: "destructive" });
    }
  }

  async function doReset() {
    try {
      await api.resetBrand();
      await api.resetBusinessSettings();
      setResetOpen(false);
      await load();
      toast({ title: "Reset to defaults", description: "Brand and business copy reverted to canon." });
    } catch (e) {
      setResetOpen(false);
      toast({ title: "Reset failed", description: errMsg(e), variant: "destructive" });
    }
  }

  // ── repeater helpers ──

  const updateProgramme = (i: number, patch: Partial<ProgrammeRow>) =>
    setFees((f) => (f ? { ...f, perProgramme: f.perProgramme.map((r, j) => (j === i ? { ...r, ...patch } : r)) } : f));
  const addProgramme = () =>
    setFees((f) => (f ? { ...f, perProgramme: [...f.perProgramme, { key: "", amount: "" }] } : f));
  const removeProgramme = (i: number) =>
    setFees((f) => (f ? { ...f, perProgramme: f.perProgramme.filter((_, j) => j !== i) } : f));
  const updateTerm = (i: number, value: string) =>
    setFees((f) => (f ? { ...f, terms: f.terms.map((t, j) => (j === i ? value : t)) } : f));
  const addTerm = () => setFees((f) => (f ? { ...f, terms: [...f.terms, ""] } : f));
  const removeTerm = (i: number) =>
    setFees((f) => (f ? { ...f, terms: f.terms.filter((_, j) => j !== i) } : f));
  const updateSecondary = (i: number, value: string) =>
    setTokens((t) => (t ? { ...t, secondary: t.secondary.map((v, j) => (j === i ? value : v)) } : t));
  const addSecondary = () =>
    setTokens((t) => (t && t.secondary.length < 12 ? { ...t, secondary: [...t.secondary, ""] } : t));
  const removeSecondary = (i: number) =>
    setTokens((t) => (t ? { ...t, secondary: t.secondary.filter((_, j) => j !== i) } : t));

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <BrandLoader size={112} />
      </div>
    );
  }

  if (error || !brand || !hero || !tokens || !logo || !firm || !fees || !letters) {
    return (
      <div className="mx-auto max-w-5xl px-5 py-10 md:px-8">
        <Card className="rounded-md border-coral/50 bg-coral/5 p-6">
          <p className="text-sm font-semibold text-danger-ink">Could not load brand &amp; business settings</p>
          <p className="mt-1 text-sm text-iron-ink">{error ?? "Unknown error"}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
            <RefreshCcw className="mr-2 h-3.5 w-3.5" /> Retry
          </Button>
        </Card>
      </div>
    );
  }

  const paletteOk = paletteValid(tokens);
  const logoOk = logoValid(logo);
  const opacityValue = Number(logo.panelOpacity);
  const opacityError =
    logo.panelOpacity === "" || !Number.isFinite(opacityValue) || opacityValue < 0 || opacityValue > 1
      ? "Enter a number between 0 and 1"
      : undefined;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 md:px-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Administration</Eyebrow>
          <SectionTitle className="mt-1.5">Brand &amp; Business</SectionTitle>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The firm&apos;s identity, letterhead, fee schedule and letter copy in one place. Edits take effect
            immediately across the app and every generated PDF.
          </p>
        </div>
        <Button variant="outline" onClick={() => setResetOpen(true)}>
          <RotateCcw className="mr-2 h-4 w-4" /> Reset to defaults
        </Button>
        <TypedConfirmDialog
          open={resetOpen}
          onOpenChange={setResetOpen}
          title="Reset brand & business to defaults?"
          description="Every edited value — brand copy, firm details, the fee schedule and letter text — is discarded and the canon defaults are restored. This cannot be undone."
          objectName={brand.title || "brand"}
          confirmLabel="Reset to defaults"
          onConfirm={() => { void doReset(); }}
        />
      </div>

      <div className="space-y-6">
        {/* (a) Brand copy */}
        <Section
          eyebrow="Brand"
          title={t("biz.brandTitle")}
          desc={t("biz.brandDesc")}
          onSave={saveBrandCopy}
          saveLabel="Save brand copy"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="brand-title" label="Wordmark" value={brand.title} onChange={(v) => setBrand({ ...brand, title: v })} />
            <Field id="brand-tagline" label="Tagline" value={brand.tagline} onChange={(v) => setBrand({ ...brand, tagline: v })} />
          </div>
          <Field id="brand-slogan" label="Slogan" value={brand.slogan} onChange={(v) => setBrand({ ...brand, slogan: v })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="brand-city" label="City" value={brand.city} onChange={(v) => setBrand({ ...brand, city: v })} />
            <Field id="brand-email" label="Email" value={brand.email} onChange={(v) => setBrand({ ...brand, email: v })} />
            <Field id="brand-phone" label="Phone" value={brand.phone} onChange={(v) => setBrand({ ...brand, phone: v })} />
            <Field id="brand-site" label="Website" value={brand.site} onChange={(v) => setBrand({ ...brand, site: v })} />
          </div>
        </Section>

        {/* (b) Landing hero */}
        <Section
          eyebrow="Landing"
          title={t("biz.heroTitle")}
          desc={t("biz.heroDesc")}
          onSave={saveHeroSection}
          saveLabel="Save landing hero"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="hero-eyebrow" label="Eyebrow" maxLength={90} value={hero.eyebrow} onChange={(v) => setHero({ ...hero, eyebrow: v })} />
            <Field id="hero-ctaPrimary" label="Primary button" maxLength={60} value={hero.ctaPrimary} onChange={(v) => setHero({ ...hero, ctaPrimary: v })} />
            <Field id="hero-ctaSecondary" label="Secondary button" maxLength={60} value={hero.ctaSecondary} onChange={(v) => setHero({ ...hero, ctaSecondary: v })} />
          </div>
          <Field id="hero-headline" label="Headline" maxLength={180} value={hero.headline} onChange={(v) => setHero({ ...hero, headline: v })} />
          <Field id="hero-subtext" label="Subtext" multiline rows={3} maxLength={500} value={hero.subtext} onChange={(v) => setHero({ ...hero, subtext: v })} />
        </Section>

        {/* (c) Colour palette */}
        <Section
          eyebrow="Palette"
          title={t("biz.coloursTitle")}
          desc={t("biz.coloursDesc")}
          onSave={savePalette}
          saveLabel="Save palette"
          disabled={!paletteOk}
        >
          <div className="space-y-2">
            <Label>Core tokens</Label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CORE_TOKENS.map(({ key, label }) => (
                <Field
                  key={key}
                  id={`tokens-${key}`}
                  label={label}
                  value={tokens[key]}
                  error={hexError(tokens[key])}
                  onChange={(v) => setTokens({ ...tokens, [key]: v })}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Shell chrome</Label>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CHROME_TOKENS.map(({ key, label }) => (
                <Field
                  key={key}
                  id={`chrome-${key}`}
                  label={label}
                  value={tokens.chrome[key]}
                  error={hexError(tokens.chrome[key])}
                  onChange={(v) => setTokens({ ...tokens, chrome: { ...tokens.chrome, [key]: v } })}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Secondary palette</Label>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              0–12 accent colours used sparingly across the app and generated documents.
            </p>
            {tokens.secondary.map((value, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Secondary colour ${i + 1}`}
                    value={value}
                    placeholder="#1CA5B1"
                    className="font-mono"
                    aria-invalid={hexError(value) ? true : undefined}
                    onChange={(e) => updateSecondary(i, e.target.value)}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove secondary colour ${i + 1}`}
                    className="h-11 w-11 shrink-0"
                    onClick={() => removeSecondary(i)}
                  >
                    <Trash2 className="h-4 w-4 text-danger-ink" />
                  </Button>
                </div>
                {hexError(value) && (
                  <p className="text-[11px] leading-relaxed text-danger-ink">{hexError(value)}</p>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="min-h-11"
              onClick={addSecondary}
              disabled={tokens.secondary.length >= 12}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add colour
            </Button>
          </div>
        </Section>

        {/* (d) Logo */}
        <Section
          eyebrow="Logo"
          title={t("biz.logoTitle")}
          desc={t("biz.logoDesc")}
          onSave={saveLogoSection}
          saveLabel="Save logo colours"
          disabled={!logoOk}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field id="logo-markColor" label="Mark colour" value={logo.markColor} error={hexError(logo.markColor)} onChange={(v) => setLogo({ ...logo, markColor: v })} />
            <Field id="logo-monogramColor" label="Monogram colour" value={logo.monogramColor} error={hexError(logo.monogramColor)} onChange={(v) => setLogo({ ...logo, monogramColor: v })} />
            <Field id="logo-panelFill" label="Panel fill" value={logo.panelFill} error={hexError(logo.panelFill)} onChange={(v) => setLogo({ ...logo, panelFill: v })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="logo-panelOpacity">Panel opacity</Label>
              <Input
                id="logo-panelOpacity"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={logo.panelOpacity}
                aria-invalid={opacityError ? true : undefined}
                aria-describedby={opacityError ? "logo-panelOpacity-err" : undefined}
                onChange={(e) => setLogo({ ...logo, panelOpacity: e.target.value })}
              />
              {opacityError && (
                <p id="logo-panelOpacity-err" className="text-[11px] leading-relaxed text-danger-ink">{opacityError}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label id="logo-darkTagline-label">Tagline on dark surfaces</Label>
              <div className="flex gap-2" role="group" aria-labelledby="logo-darkTagline-label">
                {(["cream", "gold"] as const).map((tone) => (
                  <Button
                    key={tone}
                    type="button"
                    size="sm"
                    variant={logo.darkTagline === tone ? "default" : "outline"}
                    aria-pressed={logo.darkTagline === tone}
                    className="min-h-11 capitalize"
                    onClick={() => setLogo({ ...logo, darkTagline: tone })}
                  >
                    {tone}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* (e) Firm */}
        <Section
          eyebrow="Firm"
          title={t("biz.letterheadTitle")}
          desc={t("biz.letterheadDesc")}
          onSave={saveFirm}
          saveLabel="Save firm details"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="firm-legalName" label="Legal name" value={firm.legalName} onChange={(v) => setFirm({ ...firm, legalName: v })} />
            <Field id="firm-place" label="Place" value={firm.place} onChange={(v) => setFirm({ ...firm, place: v })} />
            <Field id="firm-closing" label="Closing" value={firm.closing} onChange={(v) => setFirm({ ...firm, closing: v })} />
            <Field id="firm-signOff" label="Sign-off line" value={firm.signOff} onChange={(v) => setFirm({ ...firm, signOff: v })} />
          </div>
          <Field
            id="firm-confidentiality"
            label="Footer confidentiality line"
            value={firm.confidentiality}
            onChange={(v) => setFirm({ ...firm, confidentiality: v })}
          />
        </Section>

        {/* (f) Fees */}
        <Section
          eyebrow="Fees"
          title={t("biz.feesTitle")}
          desc={t("biz.feesDesc")}
          onSave={saveFees}
          saveLabel="Save fee schedule"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="fees-currency" label="Currency" value={fees.currency} onChange={(v) => setFees({ ...fees, currency: v })} />
            <Field
              id="fees-default"
              label="Default professional fee"
              value={fees.defaultProfessional}
              onChange={(v) => setFees({ ...fees, defaultProfessional: v })}
            />
          </div>

          <div className="space-y-2">
            <Label>Professional fee per programme</Label>
            {fees.perProgramme.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  aria-label={`Programme key ${i + 1}`}
                  value={row.key}
                  placeholder="PROGRAMME_KEY"
                  className="font-mono"
                  onChange={(e) => updateProgramme(i, { key: e.target.value })}
                />
                <Input
                  aria-label={`Programme amount ${i + 1}`}
                  value={row.amount}
                  inputMode="numeric"
                  placeholder="9800"
                  className="w-40"
                  onChange={(e) => updateProgramme(i, { amount: e.target.value })}
                />
                <Button
                  variant="ghost" size="icon"
                  aria-label={`Remove ${row.key || "programme rate"}`}
                  onClick={() => removeProgramme(i)}
                >
                  <Trash2 className="h-4 w-4 text-danger-ink" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addProgramme}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add programme rate
            </Button>
          </div>

          <Field
            id="fees-professional"
            label="Professional line label"
            value={fees.professionalLineLabel}
            onChange={(v) => setFees({ ...fees, professionalLineLabel: v })}
          />
          <Field
            id="fees-government"
            label="Government line label"
            hint={t("biz.governmentHint")}
            value={fees.governmentLineLabel}
            onChange={(v) => setFees({ ...fees, governmentLineLabel: v })}
          />
          <Field
            id="fees-disbursements"
            label="Disbursements line label"
            value={fees.disbursementsLineLabel}
            onChange={(v) => setFees({ ...fees, disbursementsLineLabel: v })}
          />

          <div className="space-y-2">
            <Label>Terms</Label>
            {fees.terms.map((term, i) => (
              <div key={i} className="flex items-start gap-2">
                <Textarea
                  aria-label={`Term ${i + 1}`}
                  value={term}
                  rows={2}
                  onChange={(e) => updateTerm(i, e.target.value)}
                />
                <Button variant="ghost" size="icon" aria-label={`Remove term ${i + 1}`} onClick={() => removeTerm(i)}>
                  <Trash2 className="h-4 w-4 text-danger-ink" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addTerm}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add term
            </Button>
          </div>
        </Section>

        {/* (g) Letters */}
        <Section
          eyebrow="Letters"
          title={t("biz.lettersTitle")}
          desc={t("biz.lettersDesc")}
          onSave={saveLetters}
          saveLabel="Save letter copy"
        >
          <div className="space-y-4">
            {LETTER_LABELS.map(({ key, label }) => (
              <Field
                key={key}
                id={`letter-${key}`}
                label={label}
                hint={t("biz.refHint")}
                value={letters.subjects[key]}
                onChange={(v) => setLetters({ ...letters, subjects: { ...letters.subjects, [key]: v } })}
              />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {ISSUER_ROLES.map(({ key, label }) => (
              <Field
                key={key}
                id={`issuer-${key}`}
                label={label}
                value={letters.issuerRoles[key] ?? ""}
                onChange={(v) => setLetters({ ...letters, issuerRoles: { ...letters.issuerRoles, [key]: v } })}
              />
            ))}
          </div>
          <LetterPreview firm={firm} letters={letters} brand={brand} />
        </Section>
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground">
        Tip: letter subjects use the tokens shown above; the fee government line uses <span className="font-mono">{"{programme}"}</span>.
        All edits are recorded in the audit trail.
      </p>
    </div>
  );
}
