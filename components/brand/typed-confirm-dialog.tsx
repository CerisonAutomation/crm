"use client";

/**
 * Typed-confirmation dialog (U4 — destructive actions name their object).
 *
 * A destructive action must not fire on a stray click. The user types the
 * object's name (case reference, user email, …) and the confirm button stays
 * disabled until it matches exactly. Used for case deletion, document
 * purging, role changes, and every other irreversible write.
 */

import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface TypedConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What is being destroyed, in plain words. */
  title: string;
  /** The consequence the user must understand before confirming. */
  description: string;
  /** The exact string the user must type — usually the object's name. */
  objectName: string;
  /** Confirm button label. Defaults to the localized "Delete". */
  confirmLabel?: string;
  /** Fires once the typed name matches and the user confirms. */
  onConfirm: () => void;
}

export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  objectName,
  confirmLabel,
  onConfirm,
}: TypedConfirmDialogProps) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");

  // Reset the field every time the dialog closes so a reopen starts clean.
  // Adjusted during render (React's documented alternative to a syncing effect)
  // rather than in an effect, which would paint one frame of the stale value.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) setTyped("");
  }

  const canConfirm = objectName.trim().length > 0 && typed.trim() === objectName.trim();

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-editorial">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <label htmlFor="typed-confirm" className="text-xs text-muted-foreground">
            {t("confirm.typeToConfirm", { name: objectName })}
          </label>
          <Input
            id="typed-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={objectName}
            autoComplete="off"
            autoFocus
            className="font-mono"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canConfirm}
            onClick={onConfirm}
            className={cn(
              "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              !canConfirm && "cursor-not-allowed opacity-50",
            )}
          >
            {confirmLabel ?? t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
