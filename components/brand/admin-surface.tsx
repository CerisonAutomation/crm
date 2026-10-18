import type { ReactNode } from "react";
import { Eyebrow, SectionTitle } from "@/components/brand/ui";

/**
 * AdminPage — the shared frame for lazily-loaded admin panels.
 *
 * Admin panels render inside the app shell's workspace region, so they own
 * only their inner layout: a bounded, padded column with a consistent header.
 * This replaces the earlier per-panel PageShell/AdminHeader copies (which were
 * never exported from the admin console and broke every panel's typecheck).
 */
export function AdminPage({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-1 py-2 md:px-0">
      {children}
    </div>
  );
}

export function AdminPageHeader({
  eyebrow,
  title,
  desc,
  actions,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <SectionTitle as="h1" className="mt-1.5">
          {title}
        </SectionTitle>
        {desc ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {desc}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
