"use client";

/**
 * Branded toast notifications.
 *
 * Wraps sonner with brand-consistent styling and helper functions
 * for common toast patterns (success, error, info, warning).
 */

import { toast as sonnerToast } from "sonner";
import { CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";

export const toast = {
  success: (message: string, description?: string) =>
    sonnerToast.success(message, {
      description,
      icon: <CheckCircle2 className="h-4 w-4 text-olive" aria-hidden="true" />,
    }),

  error: (message: string, description?: string) =>
    sonnerToast.error(message, {
      description,
      icon: <AlertCircle className="h-4 w-4 text-coral" aria-hidden="true" />,
    }),

  info: (message: string, description?: string) =>
    sonnerToast.info(message, {
      description,
      icon: <Info className="h-4 w-4 text-sky" aria-hidden="true" />,
    }),

  warning: (message: string, description?: string) =>
    sonnerToast.warning(message, {
      description,
      icon: <AlertTriangle className="h-4 w-4 text-amber-ink" aria-hidden="true" />,
    }),

  promise: sonnerToast.promise,
  dismiss: sonnerToast.dismiss,
};
