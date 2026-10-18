"use client";

/**
 * Passport scan → prefilled form, entirely in the visitor's browser.
 *
 * The public intake cannot ask for a passport photo over the wire: this is a
 * pre-auth surface, and a failed or abandoned form would leave an identity
 * document on a server. So the document is read locally — Tesseract's WASM
 * engine runs from this origin, the image is never uploaded, and the extracted
 * values are handed straight back to the form for the visitor to check.
 *
 * The parent owns the mapping from MRZ fields to its own question keys, because
 * only the parent knows which questions the selected route asked. It returns
 * how many answers it applied, so this control can be honest about the outcome
 * rather than claiming a fill that did not happen.
 */
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/brand/ui";
import { ocrImage } from "@/lib/ai/browser/ocr";
import { MRZ_CHARSET, parsePassportMrz, type PassportFields } from "@/lib/domain/mrz";
import { useI18n } from "@/lib/i18n";

type Status =
  | { kind: "idle" }
  | { kind: "reading"; percent: number }
  | { kind: "filled"; count: number }
  | { kind: "unreadable" }
  | { kind: "failed" };

export function PassportScan({
  onExtract,
  disabled,
}: {
  /** Apply the read fields to the form; return how many answers were filled. */
  onExtract: (fields: PassportFields) => number;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const reading = status.kind === "reading";

  async function scan(file: File) {
    // A PDF cannot be fed to the recogniser, and neither can a file the browser
    // guesses wrong — say so plainly instead of failing inside the WASM engine.
    if (!file.type.startsWith("image/")) {
      setStatus({ kind: "failed" });
      return;
    }
    setStatus({ kind: "reading", percent: 0 });
    try {
      const { text } = await ocrImage(file, {
        // The MRZ charset, so the `<` padding cannot come back as punctuation.
        whitelist: MRZ_CHARSET,
        // One uniform block: the MRZ is two fixed lines, and letting Tesseract
        // analyse the page as prose is what lets it wander into the filler.
        psm: "6",
        onProgress: (percent) => setStatus({ kind: "reading", percent }),
      });
      const fields = parsePassportMrz(text);
      if (!fields) {
        setStatus({ kind: "unreadable" });
        return;
      }
      const count = onExtract(fields);
      setStatus(count > 0 ? { kind: "filled", count } : { kind: "unreadable" });
    } catch {
      setStatus({ kind: "failed" });
    }
  }

  const message =
    status.kind === "reading"
      ? t("guided.scan.reading", { percent: status.percent })
      : status.kind === "filled"
        ? t("guided.scan.filled", { count: status.count })
        : status.kind === "unreadable"
          ? t("guided.scan.unreadable")
          : status.kind === "failed"
            ? t("guided.scan.failed")
            : null;

  return (
    <div className="border-l-2 border-gold bg-limestone/20 p-4">
      <p className="eyebrow text-gold-ink">{t("guided.scan.title")}</p>
      <p className="mt-2 text-sm text-iron-ink">{t("guided.scan.body")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || reading}
          onClick={() => input.current?.click()}
          className="rounded-none border-cobble px-4 py-2 text-[11px] tracking-[0.14em] text-cobble-ink hover:bg-cobble hover:text-[#F5F1EA]"
        >
          {reading ? <Spinner className="mr-2 h-3.5 w-3.5" /> : null}
          {t("guided.scan.choose")}
        </Button>
        <span className="text-[11px] text-muted-foreground">{t("guided.scan.private")}</span>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        aria-label={t("guided.scan.choose")}
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Clear first so choosing the same file again still fires a change.
          e.target.value = "";
          if (file) void scan(file);
        }}
      />

      {/* The outcome is announced, not just shown: a screen-reader user has no
          other signal that the document was read and the fields changed. */}
      <p role="status" aria-live="polite" className="mt-3 min-h-4 text-[11px] text-iron-ink">
        {message}
      </p>
    </div>
  );
}
