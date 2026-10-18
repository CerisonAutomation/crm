"use client";

/**
 * Parallax — subtle depth on scroll for the editorial hero.
 *
 * Why a rAF-driven transform rather than CSS scroll-timeline: the effect must
 * be additive (no globals.css rule to own) and must degrade to a completely
 * static page for reduced-motion users and no-JS clients. Content is visible by
 * default; the only thing this component ever changes is `transform`, which the
 * compositor can animate off the main thread.
 *
 * Depth is expressed as `speed`: a small positive value moves the layer UP as
 * the page scrolls down (it lags the scroll → reads as "behind"), a negative
 * value moves it down (leads the scroll → reads as "in front"). The translate
 * is derived from the element's distance from the viewport centre, so it is
 * seamless at the top and bottom of travel and needs no per-page tuning.
 */
import * as React from "react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/components/motion/reveal";

type ParallaxTag = "div" | "section" | "figure" | "span" | "aside" | "img";

export function Parallax({
  as = "div",
  speed = 0.12,
  clamp = 120,
  className,
  style,
  children,
  ...rest
}: {
  as?: ParallaxTag;
  /** Depth factor. ~0.05–0.2 is tasteful; >0.4 is nauseating. */
  speed?: number;
  /** Maximum pixels of travel, so a tall layer never drifts off its section. */
  clamp?: number;
  className?: string;
  children?: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "children">) {
  const ref = useRef<HTMLElement | null>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    if (typeof window === "undefined" || !window.requestAnimationFrame) return;

    let frame = 0;
    let visible = true;

    const apply = () => {
      frame = 0;
      if (!visible) return;
      const rect = el.getBoundingClientRect();
      const centre = rect.top + rect.height / 2;
      const fromCentre = centre - window.innerHeight / 2;
      const shift = Math.max(-clamp, Math.min(clamp, fromCentre * -speed));
      el.style.transform = shift === 0 ? "" : `translate3d(0, ${shift.toFixed(2)}px, 0)`;
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    // Only compute while the layer is anywhere near the viewport.
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          visible = entries.some((e) => e.isIntersecting);
          if (visible) onScroll();
        },
        { rootMargin: "20% 0px 20% 0px" },
      );
      io.observe(el);
    }

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      io?.disconnect();
      el.style.transform = "";
    };
  }, [reduced, speed, clamp]);

  return React.createElement(
    as,
    { ref, className: cn("will-change-transform", className), style, ...rest },
    children,
  );
}
