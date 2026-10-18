"use client";
/**
 * CallLauncher — the "Call / Video" buttons rendered in the case-chat headers.
 * Starting a call goes exclusively through the typed API (session credentials);
 * the launcher never invents identity — the caller's side is supplied by the
 * surrounding console from the session role.
 */
import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { useCallStore } from "./call-store";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/brand/ui";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Phone, Video } from "lucide-react";

export function CallLauncher({
  caseId,
  mySide,
  disabled,
  className,
}: {
  caseId: string | null;
  mySide: "CLIENT" | "STAFF";
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const role = useApp((s) => s.session?.role ?? null);
  const callBusy = useCallStore((s) => s.phase !== "idle");
  const start = useCallStore((s) => s.start);
  const [starting, setStarting] = useState<"AUDIO" | "VIDEO" | null>(null);

  const blocked = disabled || !caseId || role === "AUDITOR";

  async function launch(kind: "AUDIO" | "VIDEO") {
    if (blocked || callBusy || starting || !caseId) return;
    setStarting(kind);
    try {
      const { call } = await api.callStart(caseId, kind);
      // Outgoing from the start: no intermediate "incoming" phase that a
      // batched render (or a synchronous reader) could ever observe.
      start(
        call.id,
        call.caseId,
        call.caseReference,
        call.kind,
        mySide,
        call.counterparty ? call.counterparty.name : null,
        "outgoing",
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast({ title: t("call.busy"), variant: "destructive" });
      } else {
        toast({
          title: e instanceof Error ? e.message : t("call.failed"),
          variant: "destructive",
        });
      }
    } finally {
      setStarting(null);
    }
  }

  const disabledAll = blocked || callBusy || starting !== null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => void launch("AUDIO")}
        disabled={disabledAll}
        title={callBusy ? t("call.busy") : t("call.audio")}
        aria-label={`${t("call.audio")} · ${caseId ?? ""}`}
        className="h-11 w-11"
      >
        {starting === "AUDIO" ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <Phone className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => void launch("VIDEO")}
        disabled={disabledAll}
        title={callBusy ? t("call.busy") : t("call.video")}
        aria-label={`${t("call.video")} · ${caseId ?? ""}`}
        className="h-11 w-11"
      >
        {starting === "VIDEO" ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <Video className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
