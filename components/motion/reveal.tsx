"use client";

/**
 * Reveal — scroll-reveal primitive for the editorial surfaces.
 *
 * Design notes
 * ------------
 * Content is VISIBLE by default: SSR output, no-JS clients and search
 * crawlers all see the real page. The component only hides an element once it
 * is mounted, running below the fold, and motion is permitted. That decision is
 * taken in a `useLayoutEffect`, so the hide is applied before the browser
 * paints — no flash of a disappearing element.
 *
 * The animation itself lives in CSS (`globals.css`): this component's only job
 * is to toggle `reveal-init` → `is-visible` on the DOM node. It mutates
 * `classList` directly rather than holding React state — the class prop is
 * static, the toggles are one-shot, and skipping the re-render keeps the reveal
 * off the React work loop. Everything stays inside a single
 * `prefers-reduced-motion` guard. `usePrefersReducedMotion` exposes that same
 * signal to callers that need it (the wizard's directional step transition).
 */
import * as React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type RevealVariant = "up" | "mask" | "fade";
type RevealTag =
  | "div" | "section" | "article" | "li" | "span" | "header" | "footer" | "p"
  | "h1" | "h2" | "h3" | "h4" | "blockquote" | "figure" | "figcaption"
  | "nav" | "aside" | "ul" | "ol" | "dl" | "strong" | "em";

const VARIANT_CLASS: Record<RevealVariant, string> = {
  up: "",
  mask: "reveal-mask",
  fade: "reveal-fade",
};

/**
 * True when the user has asked for reduced motion. SSR-safe: returns false on
 * the server and subscribes to the media query on the client.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  React.useEffect(() => {
    if (globalThis.window === undefined || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function Reveal({
  as = "div",
  variant = "up",
  delay = 0,
  className,
  style,
  children,
  ...rest
}: {
  as?: RevealTag;
  variant?: RevealVariant;
  /** Stagger offset in milliseconds. */
  delay?: number;
  className?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "children">) {
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No observer support, or reduced motion: leave the content visible/static.
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const rect = el.getBoundingClientRect();
    const inView = rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
    if (inView) return; // above the fold — show immediately, never replay

    el.classList.add("reveal-init");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.classList.remove("reveal-init");
            el.classList.add("is-visible");
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.06 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return React.createElement(
    as,
    {
      ref,
      className: cn("reveal", VARIANT_CLASS[variant], className),
      style: delay ? ({ ...style, "--reveal-delay": `${delay}ms` } as React.CSSProperties) : style,
      ...rest,
    },
    children,
  );
}
