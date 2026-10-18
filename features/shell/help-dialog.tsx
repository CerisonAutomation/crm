"use client";
/**
 * Help dialog.
 *
 * Two audiences, one dialog. A client gets answers to the questions they
 * actually ask (how do I upload, who do I talk to, what happens next) — the
 * keyboard-shortcut list and the four-role permission matrix were noise for
 * them and are now staff-only. All strings through useI18n().
 */
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { useApp } from "@/lib/store";
import { UserRound, Briefcase, ShieldCheck, Eye, MessageCircle } from "lucide-react";

export type HelpDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** "⌘K · Ctrl K — Open the command menu" → key chip + description. */
function ShortcutRow({ line }: { line: string }) {
  const sep = line.indexOf("—");
  const keys = sep > 0 ? line.slice(0, sep).trim() : line;
  const desc = sep > 0 ? line.slice(sep + 1).trim() : "";
  return (
    <div className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2">
      <kbd className="shrink-0 rounded border border-border bg-muted px-2 py-1 font-mono text-[11px] font-semibold tracking-[0.14em] text-cobble-ink">
        {keys}
      </kbd>
      {desc && <span className="text-sm text-iron-ink">{desc}</span>}
    </div>
  );
}

const ROLE_ROWS = [
  { icon: <UserRound className="h-4 w-4" aria-hidden="true" />, key: "help.roleClient" as const },
  { icon: <Briefcase className="h-4 w-4" aria-hidden="true" />, key: "help.roleRm" as const },
  { icon: <ShieldCheck className="h-4 w-4" aria-hidden="true" />, key: "help.roleAdmin" as const },
  { icon: <Eye className="h-4 w-4" aria-hidden="true" />, key: "help.auditor" as const },
];

/** The three questions an applicant actually asks, in the order they ask them. */
const CLIENT_FAQ = [
  { q: "help.faqUploadQ" as const, a: "help.faqUploadA" as const },
  { q: "help.faqAdvisorQ" as const, a: "help.faqAdvisorA" as const },
  { q: "help.faqNextQ" as const, a: "help.faqNextA" as const },
];

export function HelpDialog({ open, onOpenChange }: HelpDialogProps) {
  const { t } = useI18n();
  const role = useApp((s) => s.session?.role);
  const isClient = role === "CLIENT";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-editorial text-xl text-cobble-ink">{t("help.title")}</DialogTitle>
          <DialogDescription>{isClient ? t("help.introClient") : t("help.intro")}</DialogDescription>
        </DialogHeader>

        {isClient && (
          <section aria-label={t("help.faqTitle")} className="rounded-lg border border-gold/40 bg-card p-3">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-ink">
              {t("help.faqTitle")}
            </p>
            <dl className="space-y-1">
              {CLIENT_FAQ.map((row) => (
                <div key={row.q} className="rounded-md px-2 py-2">
                  <dt className="text-sm font-semibold text-cobble-ink">{t(row.q)}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-iron-ink">{t(row.a)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {!isClient && (
          <section aria-label={t("help.shortcuts")} className="rounded-lg border border-border/70 bg-muted/30 p-3">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-ink">
              {t("help.shortcuts")}
            </p>
            <ShortcutRow line={t("help.scMenu")} />
            <ShortcutRow line={t("help.scEsc")} />
          </section>
        )}

        {!isClient && (
          <section aria-label={t("help.who")} className="rounded-lg border border-gold/40 bg-card p-3">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-ink">
              {t("help.who")}
            </p>
            <ul className="space-y-0.5">
              {ROLE_ROWS.map((r) => (
                <li key={r.key} className="flex min-h-11 items-start gap-3 rounded-md px-2 py-2">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-ink">
                    {r.icon}
                  </span>
                  <span className="text-sm leading-relaxed text-iron-ink">{t(r.key)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <MessageCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
          {isClient ? t("help.contactAdvisor") : t("help.contact")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
