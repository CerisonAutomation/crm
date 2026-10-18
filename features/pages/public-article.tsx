"use client";
/**
 * PublicArticle — the ONE renderer for a published Lane Page article.
 *
 * Used by BOTH the SPA Journal reader (`pages-explorer.tsx`, mounted in
 * PublicShell) AND the server-rendered `/p/[slug]` route, so what a crawler or a
 * shared link renders is byte-for-byte the same article the app shows — and the
 * builder canvas (which already renders through the same `block-renderer`) can
 * never drift from either.
 *
 * `preview` marks a DRAFT preview opened through a signed link: a banner makes
 * the draft state explicit and the enquiry form is disabled (a draft cannot
 * accept submissions — the submit endpoint requires a PUBLISHED page).
 */
import { useState } from "react";
import { api, type LaneBlock } from "@/lib/api-client";
import { PageBlocksView, readStr, readFormFields } from "./block-renderer";
import { SloganRing } from "@/components/brand/devices";
import { Eyebrow } from "@/components/brand/ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/** The public article payload — shared by the API routes and the SSR route. */
export type PublicArticleData = {
  id: string;
  title: string;
  slug: string;
  version: number;
  publishedAt: string | null;
  updatedAt: string;
  blocks: LaneBlock[];
  forms: Array<{ formKey: string; bound: boolean }>;
};

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : dateFmt.format(d);
}

/** Connector words that stay lowercase inside a humanised slug label. */
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "via", "with"]);

/**
 * Turn a URL slug into a readable editorial label — "frequently-asked-questions"
 * → "Frequently Asked Questions". The article shows a section tag, not a route.
 */
export function humanizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function PublicArticle({ page, preview = false }: { page: PublicArticleData; preview?: boolean }) {
  const when = formatDate(page.publishedAt);

  // Blocks without a hero, or with an empty one, get a synthesised headline so
  // the article always opens on the page's own title.
  const hasHero = page.blocks.some((b) => b.type === "hero");
  const blocks: LaneBlock[] = hasHero
    ? page.blocks
    : [{ key: "hero-auto", type: "hero", config: { headline: page.title, subline: "" } }, ...page.blocks];

  return (
    <article className="flex-1 mx-auto w-full max-w-3xl px-5 md:px-8 pt-12 pb-20">
      {preview && (
        <div className="mb-6 rounded-none border border-gold/60 bg-gold/10 px-4 py-3 text-[12px] leading-relaxed text-cobble-ink">
          <span className="font-semibold uppercase tracking-[0.16em] text-gold-ink">Draft preview</span> — this page is
          not published. The link expires; submissions are disabled in preview.
        </div>
      )}

      <Eyebrow>The Citizen Lane Journal</Eyebrow>

      <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge variant="outline" className="rounded-none text-[10px] tracking-[0.14em] text-iron-ink/80">
          {humanizeSlug(page.slug)}
        </Badge>
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">v{page.version}</span>
        {when && (
          <>
            <span className="text-muted-foreground/50" aria-hidden="true">·</span>
            <time className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              Published {when}
            </time>
          </>
        )}
      </div>

      {/* Every block renders — the article is the page, not just its headline. */}
      <div className="mt-6">
        <PageBlocksView blocks={blocks} />
      </div>

      <PageEnquiryForm page={page} preview={preview} />

      {/* Ornament — brand slogan ring, echoing the print devices */}
      <div className="mt-14 flex flex-col items-center gap-5 text-center">
        <SloganRing size={64} color="#B08C52" speed={44} />
        <p className="text-[10px] tracking-[0.3em] uppercase text-iron-ink">Let&apos;s create tomorrow</p>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
          This entry was published by the Citizen Lane private office in Zurich.
          For a confidential conversation about your own move, our door is a letter away.
        </p>
      </div>

      {/* Discreet CTA — private office */}
      <Card className="mt-12 rounded-none border-gold/50 bg-card/70">
        <CardContent className="p-7 md:p-9">
          <Eyebrow>Private office</Eyebrow>
          <h2 className="mt-3 font-editorial text-2xl text-cobble-ink">
            Speak with our private office — Zurich
          </h2>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-iron-ink">
            Residence and citizenship by investment — counsel that begins with a
            conversation, not a form.
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-6 rounded-none border-cobble text-cobble-ink hover:bg-cobble hover:text-[#F5F1EA]"
          >
            <a href="mailto:info@citizen-lane.com" aria-label="Email the Citizen Lane private office">
              Write to the private office
            </a>
          </Button>
        </CardContent>
      </Card>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PageEnquiryForm — turns a page's bound form block into a real submission.
// If the page carries no form block (or its formKey is unbound) a graceful
// consultation form is offered instead, so no reader ever hits a dead end.
// ─────────────────────────────────────────────────────────────────────────────

type FormFieldDef = { key: string; label: string; type: string; required: boolean };

function PageEnquiryForm({ page, preview }: { page: PublicArticleData; preview: boolean }) {
  const formBlock = page.blocks.find((b) => b.type === "form");
  const formKey = formBlock ? readStr(formBlock.config, "formKey") : "";
  const binding = page.forms.find((f) => f.formKey === formKey);
  const bound = Boolean(formKey) && binding?.bound !== false;

  const fields: FormFieldDef[] = formBlock
    ? readFormFields(formBlock.config)
    : [
        { key: "name", label: "Full name", type: "text", required: true },
        { key: "email", label: "Email", type: "email", required: true },
        { key: "message", label: "How can we help?", type: "text", required: false },
      ];

  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  const title = (formBlock ? readStr(formBlock.config, "title") : "") || "Request a consultation";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || preview) return;
    const missing = fields.filter((f) => f.required && !(values[f.key] ?? "").trim());
    if (missing.length > 0) {
      setError(`Please complete: ${missing.map((f) => f.label).join(", ")}`);
      return;
    }
    if (!consent) {
      setError("Please confirm you have read the Privacy Policy before sending.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (bound) {
        const res = await api.submitPage(page.id, values, formKey);
        setDone(res.correlated ? "Thank you — your enquiry is with our private office." : "Received — a relationship manager will be in touch.");
      } else {
        const res = await api.submitEnquiry({
          name: values.name ?? "",
          email: values.email ?? "",
          phone: values.phone,
          message: values.message,
        });
        setDone(`Received — quote reference ${res.reference} in any reply.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card className="mt-14 rounded-none border-gold/50 bg-card/70">
        <CardContent className="p-7 md:p-9">
          <Eyebrow>Enquiry received</Eyebrow>
          <p className="mt-3 text-sm leading-relaxed text-iron-ink">{done}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-14 rounded-none border-cobble/20 bg-card/70">
      <CardContent className="p-7 md:p-9">
        <Eyebrow>{bound ? "Enquiry" : "Private office"}</Eyebrow>
        <h2 className="mt-3 font-editorial text-2xl text-cobble-ink">{title}</h2>
        {preview && (
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            Submissions are disabled while previewing a draft.
          </p>
        )}
        <form onSubmit={submit} className="mt-6 space-y-4">
          {fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <label htmlFor={`pf-${f.key}`} className="text-[11px] uppercase tracking-[0.14em] text-iron-ink">
                {f.label}{f.required ? " *" : ""}
              </label>
              <input
                id={`pf-${f.key}`}
                type={f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text"}
                required={f.required}
                disabled={preview}
                value={values[f.key] ?? ""}
                onChange={(ev) => setValues((v) => ({ ...v, [f.key]: ev.target.value }))}
                className="w-full rounded-none border border-input bg-transparent px-3 py-2.5 text-sm text-cobble-ink outline-none focus-visible:ring-1 focus-visible:ring-gold disabled:opacity-60"
              />
            </div>
          ))}
          {error && <p className="text-sm text-amber-ink">{error}</p>}
          <label className="flex items-start gap-2.5 text-[12px] leading-relaxed text-iron-ink">
            <input
              type="checkbox"
              checked={consent}
              disabled={preview}
              onChange={(ev) => setConsent(ev.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#B08C52]"
              required
            />
            <span>
              I have read the{" "}
              <a href="/legal/privacy-policy" className="underline underline-offset-2 hover:text-gold-ink">
                Privacy Policy
              </a>{" "}
              and consent to being contacted about my enquiry.
            </span>
          </label>
          <Button
            type="submit"
            disabled={busy || preview}
            className="w-full rounded-none bg-cobble py-6 text-sm uppercase tracking-[0.18em] text-[#F5F1EA] hover:bg-[#1B3A54]"
          >
            {busy ? "Sending…" : "Send enquiry"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
