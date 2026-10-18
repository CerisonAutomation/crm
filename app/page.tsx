import type { Metadata } from "next";
import Home from "./home";

/**
 * Per-view document metadata for the public surfaces.
 *
 * The public views render client-side through the SPA (`/?view=…`), so they
 * cannot export `metadata` themselves — a client component never sees the
 * document head. This server page reads the `view` param and emits the
 * matching title/description, so sign-in, sign-up and the Journal each get
 * their own head instead of inheriting the generic marketing metadata from
 * the root layout. Unknown or absent views return `{}` and fall back to the
 * layout's metadata.
 */
const VIEW_META: Record<
  string,
  { title: string; description: string }
> = {
  landing: {
    title: "Citizen Lane — Citizenship & Residence by Investment",
    description:
      "Citizen Lane is the leading consultancy for residence permits through business investment in Germany and one of the leaders in the Austrian market. Let's create tomorrow.",
  },
  login: {
    title: "Sign in · Citizen Lane",
    description:
      "Sign in to your Citizen Lane client portal or staff console.",
  },
  signup: {
    title: "Create your account · Citizen Lane",
    description:
      "Open your Citizen Lane account to begin your residence or citizenship application.",
  },
  "forgot-password": {
    title: "Reset your password · Citizen Lane",
    description: "Request a password reset link for your Citizen Lane account.",
  },
  "reset-password": {
    title: "Choose a new password · Citizen Lane",
    description: "Set a new password for your Citizen Lane account.",
  },
  "verify-email": {
    title: "Verify your email · Citizen Lane",
    description: "Confirm your email address to activate your Citizen Lane account.",
  },
  "magic-link": {
    title: "Magic link · Citizen Lane",
    description: "Sign in to Citizen Lane with a passwordless magic link.",
  },
  guided: {
    title: "Start your application · Citizen Lane",
    description:
      "Begin your guided residence or citizenship application with Citizen Lane.",
  },
  "pages-explore": {
    title: "The Citizen Lane Journal",
    description:
      "Notes from the Citizen Lane private office on residence and citizenship by investment.",
  },
  "pages-reader": {
    title: "The Citizen Lane Journal",
    description:
      "Notes from the Citizen Lane private office on residence and citizenship by investment.",
  },
  procedure: {
    title: "Austria — Citizenship for Descendants · Citizen Lane",
    description:
      "The step-by-step procedure for Austrian citizenship for descendants of persecuted ancestors.",
  },
};

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { view } = await searchParams;
  const key = typeof view === "string" ? view : undefined;
  const meta = key ? VIEW_META[key] : undefined;
  if (!meta) return {};
  return { title: meta.title, description: meta.description };
}

export default function Page() {
  return <Home />;
}
