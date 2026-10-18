"use client";
/**
 * Shift/leave handoff freeze card — lets an RM freeze their queue when going
 * on leave or ending a shift, and hand off active cases to another RM.
 */

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Snowflake, Sun, Send, Loader2 } from "lucide-react";

interface ShiftFreezeCardProps {
  busy?: boolean;
}

export function ShiftFreezeCard({ busy }: ShiftFreezeCardProps) {
  const { t } = useI18n();
  const [frozen, setFrozen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [handoffTarget, setHandoffTarget] = useState("");
  const [handoffNote, setHandoffNote] = useState("");
  const [saving, setSaving] = useState(false);

  const colleagues = [
    { id: "u1", name: "Maria Santos" },
    { id: "u2", name: "João Pereira" },
    { id: "u3", name: "Ana Costa" },
  ];

  async function handleFreeze() {
    setSaving(true);
    // Simulate API call
    await new Promise((r) => setTimeout(r, 600));
    setFrozen(true);
    setSaving(false);
    setDialogOpen(false);
  }

  async function handleUnfreeze() {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    setFrozen(false);
    setSaving(false);
  }

  return (
    <>
      <Card className="rounded-md border-border p-5 md:p-6">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {t("rmq.shiftFreezeEyebrow")}
            </span>
            <h3 className="mt-1.5 font-editorial text-lg md:text-xl">{t("rmq.shiftFreezeTitle")}</h3>
          </div>
          {frozen ? (
            <Badge variant="secondary" className="gap-1">
              <Snowflake className="h-3 w-3" />
              {t("rmq.shiftFrozen")}
            </Badge>
          ) : (
            <Badge variant="default" className="gap-1">
              <Sun className="h-3 w-3" />
              {t("rmq.shiftActive")}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="mt-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            {frozen ? t("rmq.shiftFrozenDesc") : t("rmq.shiftActiveDesc")}
          </p>

          {frozen && (
            <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5">
              <p className="text-xs font-medium text-cobble-ink">{t("rmq.shiftHandoffTo")}</p>
              <p className="text-sm text-iron-ink">
                {colleagues.find((c) => c.id === handoffTarget)?.name ?? t("rmq.shiftNoHandoff")}
              </p>
              {handoffNote && (
                <p className="text-xs text-muted-foreground italic">"{handoffNote}"</p>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            {frozen ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleUnfreeze()}
                disabled={saving || busy}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sun className="h-3.5 w-3.5" />}
                {t("rmq.shiftUnfreeze")}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialogOpen(true)}
                disabled={saving || busy}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Snowflake className="h-3.5 w-3.5" />}
                {t("rmq.shiftFreeze")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Freeze dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rmq.shiftFreezeDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("rmq.shiftFreezeDialogDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="handoff-target">{t("rmq.shiftHandoffLabel")}</Label>
              <Select value={handoffTarget} onValueChange={setHandoffTarget}>
                <SelectTrigger id="handoff-target">
                  <SelectValue placeholder={t("rmq.shiftHandoffPh")} />
                </SelectTrigger>
                <SelectContent>
                  {colleagues.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="handoff-note">{t("rmq.shiftHandoffNoteLabel")}</Label>
              <Textarea
                id="handoff-note"
                value={handoffNote}
                onChange={(e) => setHandoffNote(e.target.value)}
                rows={3}
                placeholder={t("rmq.shiftHandoffNotePh")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleFreeze()} disabled={!handoffTarget || saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("rmq.shiftFreezeConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
