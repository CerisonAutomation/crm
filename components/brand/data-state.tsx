"use client";

/**
 * Shared async-data presentation.
 *
 * ONE implementation of the load/retry state that the admin console, the page
 * builder and the workflow studio had each copied verbatim (a 35-line hook plus
 * a 17-line pair of blocks, three times over). Consolidating also fixes the
 * React "latest ref" pattern: the loader is now written in an effect rather
 * than during render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { BrandLoader, Skeleton, SkeletonCard, SkeletonList, SkeletonTable } from "@/components/brand/ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export type ApiDataState<T> = {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
};

/**
 * Load data once on mount and expose a manual `reload`.
 *
 * The loader is held in a ref so `run` keeps a stable identity — otherwise an
 * inline loader would be re-created every render and the mount effect would
 * loop. The ref is assigned in an effect (React's preferred shape for a
 * "latest value" ref) rather than during render.
 */
export function useApiData<T>(loader: () => Promise<T>): ApiDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loaderRef.current());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, error, loading, reload: run };
}

/** Centred spinner + label used while async data is in flight. */
export function LoadingBlock({ label, skeleton = false }: { label?: string; skeleton?: boolean }) {
  if (skeleton) {
    return (
      <div className="space-y-4 py-8">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-full max-w-md" />
        <Skeleton className="h-3 w-full max-w-sm" />
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-4 py-16 text-sm text-muted-foreground">
      {/* The visible label is the accessible name here — the loader is decorative. */}
      <BrandLoader size={72} label="" />
      <span className="text-shimmer">{label ?? "Loading…"}</span>
    </div>
  );
}

/** Failure card with a retry affordance. */
export function ErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="rounded-md border-coral/50 bg-coral/5 p-6 modal-enter">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-coral/10">
          <RotateCcw className="h-5 w-5 text-coral" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-danger-ink">Could not load data</p>
          <p className="mt-1 text-sm text-iron-ink">{message}</p>
          <Button variant="outline" size="sm" className="mt-4 btn-press" onClick={onRetry}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      </div>
    </Card>
  );
}

/** Skeleton card for loading states. */
export function SkeletonCardBlock() {
  return <SkeletonCard />;
}

/** Skeleton list for loading states. */
export function SkeletonListBlock({ items = 3 }: { items?: number }) {
  return <SkeletonList items={items} />;
}

/** Skeleton table for loading states. */
export function SkeletonTableBlock({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return <SkeletonTable rows={rows} cols={cols} />;
}
