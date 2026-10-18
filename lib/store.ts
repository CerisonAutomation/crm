"use client";
import { create } from "zustand";
import { api, type SessionUser } from "@/lib/api-client";
import { canOpen, rememberRecent, type AdminSub } from "@/lib/nav";
import { buildRouteSearch, parseRouteSearch } from "@/lib/route-url";

/**
 * Which door a visitor is signing in through. Both audiences use the same
 * credentials and the same session; the intent only pre-selects the right
 * controls and copy, and (for a role that does not match) produces an honest
 * notice instead of a dead end.
 */
export type LoginAudience = "client" | "staff";

export type View =
  | "landing"
  | "login"
  // account lifecycle (public auth surfaces)
  | "signup"
  | "forgot-password"
  | "reset-password"
  | "verify-email"
  | "magic-link"
  // public
  | "guided"
  | "pages-explore"
  | "pages-reader"
  | "procedure"
  // client
  | "client-onboarding"
  | "client-dashboard"
  | "client-apply"
  // staff
  | "rm-queue"
  | "rm-case"
  | "crm"
  | "accounts"
  | "potentials"
  | "sales-orders"
  | "products"
  | "teams"
  | "settings"
  | "admin-dashboard"
  | "admin-users"
  | "admin-ops"
  | "admin-records"
  | "admin-audit"
  | "admin-pieces"
  | "admin-notifications"
  | "admin-flags"
  | "admin-automation"
  | "admin-business"
  | "admin-settings"
  | "admin-telemetry"
  | "admin-programmes"
  | "admin-templates"
  | "admin-news-scan"
  | "admin-parties"
  | "admin-duplicates"
  | "admin-merge-ledger"
  | "admin-work-items"
  | "admin-kyc-checks"
  | "admin-quotes"
  | "admin-refunds"
  | "admin-handoffs"
  | "admin-human-tasks"
  | "admin-provider-receipts"
  | "admin-citations"
  | "admin-prompts"
  | "admin-poll-connections"
  | "admin-availability"
  | "admin-voice"
  | "admin-business-settings"
  | "admin-form-schemas"
  | "admin-attachments"
  | "admin-mcp"
  | "admin-offline"
  | "admin-webhook-inbox"
  | "admin-conversation-inbox"
  | "admin-bookings"
  | "admin-reminders"
  | "admin-triage"
  | "studio-workflows"
  | "studio-detail"
  | "studio-runs"
  | "pages-list"
  | "pages-editor";

type AppState = {
  session: SessionUser | null;
  view: View;
  /** Which door the visitor came through. The merged product has ONE sign-in
   *  that serves two audiences (the applicant's portal and the staff console),
   *  so the landing's staff door records the intent here and the login surface
   *  reads it. Not a URL param: the route contract owns exactly
   *  `view/id/slug/panel` (tests/url-routing.test.ts) and signing in is a
   *  session-level intent, not a shareable document state. */
  loginAudience: LoginAudience;
  activeCaseId: string | null; // RM: selected case
  activeWorkflowId: string | null; // studio: selected workflow
  activePageId: string | null; // pages: selected page
  activePublicSlug: string | null; // public reader: selected published page
  adminPanel: AdminSub; // admin-automation: which panel renders (URL `panel=`)
  pendingResetToken: string | null; // password reset: token handed over from forgot-password
  booted: boolean;
  setSession: (u: SessionUser | null) => void;
  setView: (v: View) => void;
  setLoginAudience: (a: LoginAudience) => void;
  setAdminPanel: (p: AdminSub) => void;
  setPendingResetToken: (t: string | null) => void;
  setActiveCase: (id: string | null) => void;
  setActiveWorkflow: (id: string | null) => void;
  setActivePage: (id: string | null) => void;
  setPublicPage: (slug: string | null) => void;
  boot: () => Promise<void>;
  logout: () => Promise<void>;
};

/** Runtime membership test for the `View` union — typed as `Record<View, …>`
 *  so a new union member fails to compile until it is listed here. */
const VIEW_VALUES: Record<View, true> = {
  landing: true,
  login: true,
  signup: true,
  "forgot-password": true,
  "reset-password": true,
  "verify-email": true,
  "magic-link": true,
  guided: true,
  "pages-explore": true,
  "pages-reader": true,
  procedure: true,
  "client-onboarding": true,
  "client-dashboard": true,
  "client-apply": true,
  "rm-queue": true,
  "rm-case": true,
  crm: true,
  accounts: true,
  potentials: true,
  "sales-orders": true,
  products: true,
  teams: true,
  settings: true,
  "admin-dashboard": true,
  "admin-users": true,
  "admin-ops": true,
  "admin-records": true,
  "admin-audit": true,
  "admin-pieces": true,
  "admin-notifications": true,
  "admin-flags": true,
  "admin-automation": true,
  "admin-business": true,
  "admin-settings": true,
  "admin-telemetry": true,
  "admin-programmes": true,
  "admin-templates": true,
  "admin-news-scan": true,
  "admin-parties": true,
  "admin-duplicates": true,
  "admin-merge-ledger": true,
  "admin-work-items": true,
  "admin-kyc-checks": true,
  "admin-quotes": true,
  "admin-refunds": true,
  "admin-handoffs": true,
  "admin-human-tasks": true,
  "admin-provider-receipts": true,
  "admin-citations": true,
  "admin-prompts": true,
  "admin-poll-connections": true,
  "admin-availability": true,
  "admin-voice": true,
  "admin-business-settings": true,
  "admin-form-schemas": true,
  "admin-attachments": true,
  "admin-mcp": true,
  "admin-offline": true,
  "admin-webhook-inbox": true,
  "admin-conversation-inbox": true,
  "admin-bookings": true,
  "admin-reminders": true,
  "admin-triage": true,
  "studio-workflows": true,
  "studio-detail": true,
  "studio-runs": true,
  "pages-list": true,
  "pages-editor": true,
};
const VIEW_SET: ReadonlySet<string> = new Set(Object.keys(VIEW_VALUES));

/** The destination a URL resolves to: the view, detail-record ids and panel. */
type Destination = {
  view: View;
  activeCaseId: string | null;
  activeWorkflowId: string | null;
  activePageId: string | null;
  activePublicSlug: string | null;
  adminPanel: AdminSub;
};

/** A URL resolution: the destination, the raw `view` param, and the view the
 *  resolver chain produced (null when the param resolved to nothing). boot()
 *  keeps the raw param when the chain resolves exactly to the final view, so
 *  canonical alias URLs (`/journal`, `/dashboard`) survive the load. */
type Resolution = Destination & {
  requested: string | null;
  chainView: View | null;
};

/** Set while a popstate handler applies the URL to the store. Back/Forward
 *  restores state only — pushing a URL from a popstate handler is the classic
 *  navigation loop, so the flag makes "do not write the URL" explicit. */
let suppressUrlSync = false;

export const useApp = create<AppState>((set, get) => {
  /**
   * Mirror the store's destination into the URL (see route-url.ts for the
   * param contract). Starts from the CURRENT `location.search` and only
   * touches the params this store owns, so unrelated params — `token` from
   * the reset-password handoff — always survive. `landing` strips every
   * owned param so the root stays a clean `/`. Skips the write when the URL
   * already matches (no duplicate history entries), never reads back into the
   * store, honours `suppressUrlSync` around popstate, and only syncs the SPA
   * root: the standalone routes (`/verify-email`, `/magic-link`,
   * `/reset-password`) hand off themselves, so their path is left alone.
   */
  function writeUrl(
    mode: "push" | "replace",
    preserveView: string | null = null,
  ): void {
    if (typeof window === "undefined" || window.location.pathname !== "/")
      return;
    if (suppressUrlSync) return;
    const query = buildRouteSearch(window.location.search, get(), preserveView);
    const target = query ? `/?${query}` : "/";
    if (target === `${window.location.pathname}${window.location.search}`)
      return;
    if (mode === "push")
      window.history.pushState(window.history.state, "", target);
    else window.history.replaceState(window.history.state, "", target);
  }

  return {
    session: null,
    view: "landing",
    loginAudience: "client",
    activeCaseId: null,
    activeWorkflowId: null,
    activePageId: null,
    activePublicSlug: null,
    adminPanel: "automation",
    pendingResetToken: null,
    booted: false,
    setSession: (u) => {
      set({
        session: u,
        view: u ? defaultViewFor(u) : "login",
        adminPanel: "automation",
      });
      writeUrl("push");
    },
    setView: (v) => {
      // Leaving admin-automation drops the panel back to its default, mirroring
      // the URL (the `panel` param only exists while that view is open).
      set((s) => ({
        view: v,
        adminPanel: v === "admin-automation" ? s.adminPanel : "automation",
      }));
      writeUrl("push");
    },
    setLoginAudience: (a) => set({ loginAudience: a }),
    setAdminPanel: (p) => {
      set({ adminPanel: p });
      writeUrl("push");
    },
    setPendingResetToken: (t) => set({ pendingResetToken: t }),
    setActiveCase: (id) => {
      set({ activeCaseId: id, view: id ? "rm-case" : "rm-queue" });
      writeUrl("push");
    },
    setActiveWorkflow: (id) => {
      set({
        activeWorkflowId: id,
        view: id ? "studio-detail" : "studio-workflows",
      });
      writeUrl("push");
    },
    setActivePage: (id) => {
      set({ activePageId: id, view: id ? "pages-editor" : "pages-list" });
      writeUrl("push");
    },
    setPublicPage: (slug) => {
      set({
        activePublicSlug: slug,
        view: slug ? "pages-reader" : "pages-explore",
      });
      writeUrl("push");
    },
    boot: async () => {
      bindPopstate();
      bindRecents();
      try {
        const { user } = await api.session();
        const { requested, chainView, ...dest } = resolveDestination(user);
        set({ session: user, ...dest, booted: true });
        // replaceState, never push: loading a URL must not add a history
        // entry. The raw param is kept when it already resolves here so
        // canonical entry URLs (`/journal`, `/dashboard`) stay intact.
        writeUrl(
          "replace",
          requested && chainView === dest.view ? requested : null,
        );
      } catch {
        // Session probe unreachable (offline, server restarting): resolve the
        // URL as a guest instead of forcing the landing page, so a deep-linked
        // public surface (sign-in, guided intake, Journal) survives a flaky
        // network rather than bouncing to marketing.
        const { requested, chainView, ...dest } = resolveDestination(null);
        set({ session: null, ...dest, adminPanel: "automation", booted: true });
        writeUrl(
          "replace",
          requested && chainView === dest.view ? requested : null,
        );
      }
    },
    logout: async () => {
      await api.logout().catch(() => undefined);
      set({
        session: null,
        view: "landing",
        activeCaseId: null,
        activeWorkflowId: null,
        activePageId: null,
        activePublicSlug: null,
        adminPanel: "automation",
      });
      writeUrl("push");
    },
  };
});

/** The `?view=` param when it is a literal member of the `View` union, else null. */
function directView(param: string | null): View | null {
  if (!param) return null;
  const value = param.toLowerCase();
  return VIEW_SET.has(value) ? (value as View) : null;
}

/**
 * Resolve the current URL (plus session) into the destination the store should
 * show. Shared by `boot()` (initial load) and the `popstate` handler
 * (Back/Forward) so both apply identical rules:
 *
 * - guests: public views and aliases first; an app view the visitor cannot
 *   open without a session routes to `login` (a manifest shortcut is never a
 *   dead end, and a wrong-role screen is never reachable);
 * - signed-in: public surfaces stay reachable (shared Journal links, the
 *   verify-email banner), then direct `?view=<View>` deep links — gated by
 *   `canOpen`, falling back to `defaultViewFor` for anything the role cannot
 *   open, then the credential screens (a signed-in user never lands back on
 *   login/signup/forgot-password), then detail-view id fallbacks.
 *
 * Pure read — never touches the URL or the store.
 */
function resolveDestination(user: SessionUser | null): Resolution {
  if (typeof window === "undefined") {
    return {
      view: "landing",
      activeCaseId: null,
      activeWorkflowId: null,
      activePageId: null,
      activePublicSlug: null,
      adminPanel: "automation",
      requested: null,
      chainView: null,
    };
  }
  const route = parseRouteSearch(window.location.search);
  const requested = route.view;
  const slug = route.slug;
  if (!user) {
    // Every public (pre-auth) view is deep-linkable — the auth surfaces, the
    // guided intake, and the Journal index/reader. Any other named view is an
    // app view: a guest deep-linking it goes to sign-in instead of a screen
    // they could not open (or, for PWA-shortcut aliases, the marketing page
    // only when the param names no view at all).
    const pub = resolvePublicView(requested, slug);
    const direct = directView(requested);
    const guestBlocked = direct !== null && !canOpen(direct, null);
    const chainView =
      pub?.view ?? (guestBlocked || isAppShortcut(requested) ? "login" : null);
    return {
      view: chainView ?? "landing",
      activeCaseId: null,
      activeWorkflowId: null,
      activePageId: null,
      activePublicSlug: pub?.slug ?? null,
      adminPanel: "automation",
      // A blocked app view normalises the URL to `view=login` (the screen
      // that renders); public aliases (`journal`) and shortcut params
      // (`dashboard`) keep their raw value so canonical URLs survive.
      requested: guestBlocked ? null : requested,
      chainView,
    };
  }
  // Honour app-launch deep links — PWA manifest shortcuts and push
  // notifications open "/?view=…" — then any direct view the URL names, so a
  // refresh or Back/Forward lands exactly where the user was.
  const deep = resolveDeepLink(requested, user, slug);
  const chainView = deep?.view ?? directView(requested);
  let view = chainView ?? defaultViewFor(user);
  const activePublicSlug = deep?.slug ?? null;
  // Role gate: a URL naming a view this role cannot open falls back to the
  // role's home — deep links and Back/Forward never render a wrong-role screen.
  if (!canOpen(view, user.role)) view = defaultViewFor(user);
  // Auth-surface back-guard: a signed-in user never lands back on the
  // credential screens. verify-email / reset-password / magic-link stay
  // reachable (token flows + the shell's verify banner).
  if (view === "login" || view === "signup" || view === "forgot-password")
    view = defaultViewFor(user);
  // A detail screen without its record id renders an empty shell — fall back
  // to the list parent instead.
  const id = route.id;
  if (view === "rm-case" && !id) view = "rm-queue";
  else if (view === "studio-detail" && !id) view = "studio-workflows";
  else if (view === "pages-editor" && !id) view = "pages-list";
  else if (view === "pages-reader" && !activePublicSlug) view = "pages-explore";
  return {
    view,
    activeCaseId: view === "rm-case" ? id : null,
    activeWorkflowId: view === "studio-detail" ? id : null,
    activePageId: view === "pages-editor" ? id : null,
    activePublicSlug,
    adminPanel:
      view === "admin-automation" && route.panel === "integrations"
        ? "integrations"
        : "automation",
    requested,
    chainView,
  };
}

let popstateBound = false;

/**
 * Apply Back/Forward to the store — registered exactly once (module guard),
 * from `boot()`, which only ever runs client-side. The handler resolves the
 * URL (view + ids + panel) and writes ONLY store state under the suppress
 * flag: pushing or replacing the URL from a popstate handler is what creates
 * a navigation loop, so it must never happen.
 */
function bindPopstate(): void {
  if (popstateBound || typeof window === "undefined") return;
  popstateBound = true;
  window.addEventListener("popstate", () => {
    const {
      view,
      activeCaseId,
      activeWorkflowId,
      activePageId,
      activePublicSlug,
      adminPanel,
    } = resolveDestination(useApp.getState().session);
    suppressUrlSync = true;
    try {
      useApp.setState({
        view,
        activeCaseId,
        activeWorkflowId,
        activePageId,
        activePublicSlug,
        adminPanel,
      });
    } finally {
      suppressUrlSync = false;
    }
  });
}

let recentsBound = false;

/**
 * Record every view change — from any source (nav, palette, Back/Forward) —
 * in the palette's recent list. Registered once from `boot()`. Only signed-in
 * sessions are recorded; non-NAV views (details, auth surfaces) are skipped
 * inside `rememberRecent` itself.
 */
function bindRecents(): void {
  if (recentsBound || typeof window === "undefined") return;
  recentsBound = true;
  useApp.subscribe((state, prev) => {
    if (state.view === prev.view || !state.session) return;
    rememberRecent(
      state.view === "admin-automation"
        ? { view: state.view, sub: state.adminPanel }
        : { view: state.view },
    );
  });
}

/** A resolved deep link: the view to open and, for the reader, the page slug. */
type DeepLink = { view: AppState["view"]; slug: string | null };

/**
 * Public (pre-auth) views reachable via `?view=`. Covers the auth surfaces, the
 * guided intake and the Journal (`?view=journal`, `?view=article&slug=…`). Any
 * of them may be opened by a signed-out visitor, so the landing page is only the
 * fallback for an unknown or missing value.
 */
function resolvePublicView(
  param: string | null,
  slug: string | null,
): DeepLink | null {
  if (!param) return null;
  switch (param.toLowerCase()) {
    case "login":
      return { view: "login", slug: null };
    case "signup":
      return { view: "signup", slug: null };
    case "forgot-password":
      return { view: "forgot-password", slug: null };
    case "reset-password":
      return { view: "reset-password", slug: null };
    case "verify-email":
      return { view: "verify-email", slug: null };
    case "magic-link":
      return { view: "magic-link", slug: null };
    case "guided":
      return { view: "guided", slug: null };
    case "procedure":
      return { view: "procedure", slug: null };
    case "journal":
    case "pages":
    case "pages-explore":
      return { view: "pages-explore", slug: null };
    case "article":
    case "pages-reader":
      // A reader link without a slug has nothing to show — fall back to the index.
      return slug
        ? { view: "pages-reader", slug }
        : { view: "pages-explore", slug: null };
    default:
      return null;
  }
}

/** App-launch shortcuts a guest cannot open; they route to sign-in, not the marketing page. */
function isAppShortcut(param: string | null): boolean {
  if (!param) return false;
  return ["case", "messages", "queue", "dashboard", "settings"].includes(
    param.toLowerCase(),
  );
}

/** Map an app-launch `?view=` param (PWA shortcuts, push links) to a view the role may open. */
function resolveDeepLink(
  param: string | null,
  u: SessionUser,
  slug: string | null,
): DeepLink | null {
  if (!param) return null;
  // Public surfaces stay reachable when signed in (a shared Journal link opens
  // the article even for a signed-in staff member).
  const pub = resolvePublicView(param, slug);
  if (pub) return pub;
  const isClient = u.role === "CLIENT";
  switch (param.toLowerCase()) {
    case "case":
    case "messages":
      return { view: isClient ? "client-dashboard" : "rm-queue", slug: null };
    case "queue":
      return { view: isClient ? "client-dashboard" : "rm-queue", slug: null };
    case "settings":
      return { view: "settings", slug: null };
    case "dashboard":
      return { view: defaultViewFor(u), slug: null };
    default:
      return null;
  }
}

/** Role-appropriate landing view for a signed-in user (also used by auth surfaces to avoid hard-coding a client destination). */
export function defaultViewFor(u: SessionUser): AppState["view"] {
  switch (u.role) {
    case "CLIENT":
      // A client whose details are submitted has left onboarding and belongs on
      // their dashboard — their home per getting-started.tsx, and the only view
      // where the client Getting-Started checklist mounts. This ternary
      // previously returned "client-onboarding" on BOTH branches, so the test
      // was dead and every client, submitted or not, was dropped into the
      // wizard instead of their case.
      return u.profileState === "SUBMITTED"
        ? "client-dashboard"
        : "client-onboarding";
    case "RM":
    case "SENIOR_RM":
    case "AUDITOR":
      return "rm-queue";
    case "ADMIN":
      return "admin-dashboard";
    default:
      return "landing";
  }
}
