"use client";

/**
 * Form field wrapper with validation feedback.
 *
 * Wraps an input with label, error message, and hint text.
 * Provides consistent styling and accessibility attributes.
 */

import { cloneElement, isValidElement } from "react";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

export function FormField({
  label,
  error,
  hint,
  required,
  requiredText,
  children,
  className,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Screen-reader suffix for the required marker (defaults to English). */
  requiredText?: string;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  // Wire hint/error to the field: the label points at the real control id,
  // and the control gets aria-describedby + aria-invalid so SR users hear
  // the same guidance sighted users read below the field.
  const childId =
    isValidElement<{ id?: string }>(children) && children.props.id
      ? children.props.id
      : (htmlFor ?? label.toLowerCase().replace(/\s+/g, "-"));
  const errorId = `${childId}-error`;
  const hintId = `${childId}-hint`;
  const describedBy = [error ? errorId : null, hint && !error ? hintId : null]
    .filter(Boolean)
    .join(" ") || undefined;
  const field = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        id: childId,
        ...(describedBy ? { "aria-describedby": describedBy } : undefined),
        ...(error ? { "aria-invalid": true } : undefined),
      })
    : children;

  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={childId} className="text-sm font-medium text-iron-ink">
        {label}
        {required && (
          <>
            <span className="text-coral ml-0.5" aria-hidden="true">*</span>
            <span className="sr-only"> ({requiredText ?? "required"})</span>
          </>
        )}
      </label>
      {field}
      {error && (
        <p id={errorId} className="flex items-center gap-1 text-xs text-danger-ink" role="alert">
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          {error}
        </p>
      )}
      {hint && !error && <p id={hintId} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
