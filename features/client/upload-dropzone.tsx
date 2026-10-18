"use client";

/**
 * UploadDropzone — drag & drop / browse upload for the Documents tab.
 *
 * Auto-matching (honest, no fake success):
 *  - exactly one open request  → every dropped file matches it;
 *  - multiple open requests    → files are matched by docType keyword in the
 *    filename (passport / id / police / bank / certificate / registration,
 *    case-insensitive); anything unmatched lands in a small chooser where the
 *    client assigns it to one of the open requests;
 *  - zero open requests        → the zone is disabled with its hint (uploads
 *    in this product are request-driven; no "upload to nowhere").
 *
 * The upload path is EXACTLY the one the per-request Upload buttons use:
 * prepareUpload → api.uploadDocument (same toasts, same refresh callback).
 */

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { CheckCircle2, FileUp, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { usePlatformSettings } from "@/lib/settings/client";
import { prepareUpload } from "@/lib/upload-image";
import { acceptAttribute, clampUploadMb, extensionRegex, fileAccepted } from "@/lib/upload/accept";
import { api, ApiError, type RequestRow } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Spinner } from "@/components/brand/ui";
import { Button } from "@/components/ui/button";
import { NAMING_CONVENTION_HINT } from "@/lib/documents/naming";

function errMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

/** Local interpolation for the clx.* templates ("{var}" or "{{var}}"). */
function tr(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.split(`{{${k}}}`).join(String(v)).split(`{${k}}`).join(String(v)),
    template
  );
}

/** docType → filename keyword match (case-insensitive, boundary-aware for "id"). */
function matchRequestForFile(file: File, openRequests: RequestRow[]): RequestRow | null {
  const name = file.name.toLowerCase();
  const byType = new Map(openRequests.map((r) => [r.docType, r]));
  const rules: Array<{ type: string; test: (n: string) => boolean }> = [
    { type: "PASSPORT", test: (n) => n.includes("passport") },
    { type: "NATIONAL_ID", test: (n) => /(^|[^a-z])id([^a-z]|$)/.test(n) || n.includes("identity") },
    { type: "POLICE_RECORD", test: (n) => n.includes("police") },
    { type: "BANK_STATEMENT", test: (n) => n.includes("bank") },
    {
      type: "CERTIFICATE_OF_REGISTRATION",
      test: (n) => n.includes("certificate") || n.includes("registration"),
    },
  ];
  for (const rule of rules) {
    if (!rule.test(name)) continue;
    const hit = byType.get(rule.type);
    if (hit) return hit;
  }
  return null;
}

type MatchedNote = { key: string; fileName: string; requestTitle: string };
type PendingFile = { key: string; file: File };

const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export function UploadDropzone({
  openRequests,
  onUploaded,
  className,
}: {
  openRequests: RequestRow[];
  onUploaded: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  const { settings } = usePlatformSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  // Cap + accept list shown in the hints come from the admin-editable settings (canon underneath).
  const maxMb = clampUploadMb(settings.operations.maxUploadMb);
  const maxBytes = maxMb * 1024 * 1024;
  const extRe = extensionRegex(settings.operations.acceptedExtensions);
  const accept = acceptAttribute(settings.operations.acceptedExtensions);

  const [dragActive, setDragActive] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [matched, setMatched] = useState<MatchedNote[]>([]);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const disabled = openRequests.length === 0;

  const uploadOne = useCallback(async (file: File, request: RequestRow) => {
    const prepared = await prepareUpload(file);
    await api.uploadDocument({
      type: request.docType,
      fileName: prepared.fileName,
      mimeType: prepared.mimeType,
      dataBase64: prepared.dataBase64,
      requestId: request.id,
    });
  }, []);

  const runAssignments = useCallback(
    async (assignments: Array<{ file: File; request: RequestRow; key: string }>) => {
      let landed = 0;
      for (const a of assignments) {
        try {
          await uploadOne(a.file, a.request);
          landed += 1;
          toast({ title: "Document received", description: `${a.file.name} was uploaded and scanned.` });
        } catch (err) {
          toast({ title: "Upload failed", description: errMessage(err, "Please try again."), variant: "destructive" });
        } finally {
          setInFlight((n) => Math.max(0, n - 1));
          setMatched((prev) => prev.filter((m) => m.key !== a.key));
        }
      }
      if (landed > 0) onUploaded();
    },
    [uploadOne, onUploaded]
  );

  const handleFiles = useCallback(
    async (files: File[]) => {
      if (disabled || files.length === 0) return;

      const bad = files.filter((f) => !fileAccepted(f, extRe) || f.size > maxBytes);
      const ok = files.filter((f) => fileAccepted(f, extRe) && f.size <= maxBytes);
      if (bad.length > 0) {
        toast({
          title: "Unsupported file",
          description: `${bad.length} file${bad.length === 1 ? "" : "s"} skipped — please use ${settings.operations.acceptedExtensions
            .map((e) => e.toUpperCase())
            .join(", ")} up to ${maxMb} MB.`,
          variant: "destructive",
        });
      }
      if (ok.length === 0) return;

      // Auto-match: single open request takes everything; otherwise keyword match.
      const single = openRequests.length === 1 ? openRequests[0] : null;
      const assignments: Array<{ file: File; request: RequestRow; key: string }> = [];
      const unmatched: PendingFile[] = [];
      for (const f of ok) {
        const key = fileKey(f);
        const request = single ?? matchRequestForFile(f, openRequests);
        if (request) {
          assignments.push({ file: f, request, key });
          setMatched((prev) =>
            prev.some((m) => m.key === key)
              ? prev
              : [...prev, { key, fileName: f.name, requestTitle: request.title }]
          );
        } else {
          unmatched.push({ key, file: f });
        }
      }

      if (assignments.length > 0) setInFlight((n) => n + assignments.length);
      if (unmatched.length > 0) {
        setPending((prev) => [...prev.filter((p) => !unmatched.some((u) => u.key === p.key)), ...unmatched]);
      }
      if (assignments.length > 0) await runAssignments(assignments);
    },
    [disabled, openRequests, runAssignments, extRe, maxBytes, maxMb, settings.operations.acceptedExtensions]
  );

  /** Chooser: assign a previously unmatched file to an open request → upload. */
  const assignPending = useCallback(
    async (item: PendingFile, request: RequestRow) => {
      if (busyKey) return;
      setBusyKey(item.key);
      setMatched((prev) =>
        prev.some((m) => m.key === item.key) ? prev : [...prev, { key: item.key, fileName: item.file.name, requestTitle: request.title }]
      );
      setInFlight((n) => n + 1);
      await runAssignments([{ file: item.file, request, key: item.key }]);
      setPending((prev) => prev.filter((p) => p.key !== item.key));
      setBusyKey(null);
    },
    [busyKey, runAssignments]
  );

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    void handleFiles(files);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    void handleFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled && !dragActive) setDragActive(true);
  };

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !e.currentTarget.contains(next)) setDragActive(false);
  };

  return (
    <section aria-label={t("clx.dropTitle")} className={cn("space-y-3", className)}>
      <div
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        aria-disabled={disabled || undefined}
        className={cn(
          "rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors",
          disabled && "opacity-60",
          dragActive ? "border-gold bg-gold/10" : "border-limestone bg-muted/30"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="sr-only"
          aria-label={t("clx.dropTitle")}
          disabled={disabled}
          onChange={onInputChange}
        />
        <FileUp className="mx-auto h-5 w-5 text-gold-ink" aria-hidden="true" />
        <p className="mt-2 font-editorial text-lg text-cobble-ink">{t("clx.dropTitle")}</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{t("clx.dropHint")}</p>
        <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 min-h-11"
                  disabled={disabled || inFlight > 0}
                  onClick={() => inputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" /> {t("clx.dropBrowse")}
                </Button>
                <p className="mt-3 text-xs text-muted-foreground max-w-md mx-auto">
                  {t("clx.dropNamingHint", { example: NAMING_CONVENTION_HINT.example })}
                </p>
              </div>

      {inFlight > 0 && (
        <p role="status" className="flex items-center gap-2 text-sm text-iron-ink">
          <Spinner className="h-4 w-4" /> {tr(t("clx.dropUploading"), { n: inFlight })}
        </p>
      )}

      {matched.length > 0 && (
        <ul className="space-y-1.5" aria-live="polite">
          {matched.map((m) => (
            <li key={m.key} className="flex items-center gap-2 text-sm text-iron-ink">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
              <span className="truncate">
                <span className="font-medium text-cobble-ink">{m.fileName}</span> — {tr(t("clx.dropMatched"), { request: m.requestTitle })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && !disabled && (
        <div className="space-y-3 rounded-md border border-gold/40 bg-gold/5 p-3.5">
          <p className="text-sm font-medium text-cobble-ink">{t("clx.dropUnmatched")}</p>
          {pending.map((p) => (
            <div key={p.key} className="space-y-2 rounded border border-border bg-card p-3">
              <p className="truncate text-sm text-iron-ink">{p.file.name}</p>
              <div className="flex flex-wrap gap-2">
                {openRequests.map((r) => (
                  <Button
                    key={r.id}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    disabled={busyKey === p.key || inFlight > 0}
                    onClick={() => void assignPending(p, r)}
                  >
                    {busyKey === p.key ? <Spinner className="h-3.5 w-3.5" /> : null}
                    {r.title}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
