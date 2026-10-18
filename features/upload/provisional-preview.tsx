"use client";
/**
 * ProvisionalPreview - stage-1 read shown next to the upload preview.
 *
 * Display-only: MRZ candidate lines, confidence, quality, engine + timestamp,
 * and the structural never-auto-approve banner. There is deliberately NO
 * approve control here - approval lives on the FS-9 review surface, gated by
 * assertHumanGate (reviewer != uploader, reason mandatory). Cancel aborts the
 * in-browser passes via AbortController.
 */
import { PROVISIONAL_DISCLAIMER, type ProvisionalResult, type OcrQuality } from "@/lib/adapters/ocr/types";
import type { ProvisionalProgress } from "@/lib/adapters/ocr/provisional";
import { cn } from "@/lib/utils";

const QUALITY_LABEL: Record<OcrQuality, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair - reviewer should look closely",
  poor: "Poor - re-scan likely needed",
};

export function ProvisionalPreview({
  result,
  progress,
  onCancel,
  scanning,
  className,
}: {
  result: ProvisionalResult | null;
  progress: ProvisionalProgress | null;
  onCancel?: () => void;
  scanning: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border p-4", className)} aria-live="polite">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Provisional read - not verified
      </p>
      <p className="mt-1 text-sm font-medium">{PROVISIONAL_DISCLAIMER}</p>

      {scanning && (
        <div className="mt-3">
          <p className="text-sm">
            {progress ? progress.stage + " - " + progress.percent + "%" : "Starting scan..."}
          </p>
          <div className="mt-1 h-2 overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: (progress ? progress.percent : 5) + "%" }}
            />
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="mt-2 inline-flex min-h-[44px] items-center rounded-md border px-4 text-sm font-medium"
            >
              Cancel scan
            </button>
          )}
        </div>
      )}

      {!scanning && result && (
        <div className="mt-3 space-y-2">
          <p className="text-sm">
            Confidence: <strong>{Math.round(result.confidence * 100)}%</strong> - {QUALITY_LABEL[result.quality]}
          </p>
          {result.mrz ? (
            <div>
              <p className="text-sm font-medium">
                MRZ candidate {result.mrz.isValid ? "(check digits pass)" : "(check digits FAIL - treat as unread)"}
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                {result.mrz.line1}{"\n"}{result.mrz.line2}
              </pre>
              {result.mrz.fields.fullName && (
                <p className="mt-1 text-sm">Name: {result.mrz.fields.fullName}</p>
              )}
              {result.mrz.fields.documentNumber && (
                <p className="text-sm">Document: {result.mrz.fields.documentNumber}</p>
              )}
            </div>
          ) : (
            <p className="text-sm">No machine-readable zone detected in this scan.</p>
          )}
          <p className="text-xs text-muted-foreground">
            {result.model} - {result.createdAt}
          </p>
        </div>
      )}
    </div>
  );
}
