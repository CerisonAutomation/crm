"use client";

/**
 * Settings — one calm surface for everything personal:
 * Profile (real PATCH), Notifications (shared prefs dialog + VAPID push),
 * Language, Mobile app (PWA), Privacy & data (GDPR export/erasure),
 * Integrations (ADMIN, links to the admin integrations panel).
 * Every string via the i18n barrel; every action via the typed api client.
 */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  BellRing, Building2, CalendarDays, CheckCircle2, Download, Globe, KeyRound, Loader2, Mail, MapPin,
  Monitor, Moon, Palette, Phone, ShieldCheck, SlidersHorizontal, Smartphone, Sun, UserRound,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { can } from "@/lib/domain/states";
import { useI18n, LOCALES, type Locale } from "@/lib/i18n";
import { usePreferences, type Density, type TextSize, type ThemeChoice, type UiMode } from "@/lib/ui-mode";
import { validatePassword } from "@/lib/password-policy";
import { usePasswordMinLength } from "@/lib/policy";
import { describeAuthError } from "@/features/auth/auth-errors";
import { Spinner } from "@/components/brand/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NotificationPrefsDialog } from "@/features/shell/notification-prefs-dialog";
import { Switch } from "@/components/ui/switch";
import { usePwaInstall } from "@/components/pwa/use-pwa-install";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Mic, Video, Sparkles } from "lucide-react";

/**
 * Desk settings — the SAME registry-driven editor the admin console uses
 * (src/features/admin/platform-settings.tsx), limited to the sections the
 * caller's role may write. Lazy-loaded so the editor code only ships to the
 * roles that can reach it (RM/SENIOR_RM).
 */
const DeskPlatformSettings = dynamic(
  () => import("@/features/admin/platform-settings").then((m) => m.DeskPlatformSettings),
  {
    loading: () => (
      <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    ),
  },
);

type Profile = Awaited<ReturnType<typeof api.profile>>["profile"];

export function SettingsView() {
  const { t, locale, setLocale } = useI18n();
  const { session, setView } = useApp();
  const { canInstall, installed, install } = usePwaInstall();
  const { prefs, mode, setPrefs } = usePreferences(session?.role ?? null);
  const pwMin = usePasswordMinLength();

  // Desk-owned settings (operations, rm) are editable by RM/SENIOR_RM through the
  // desk-scoped capability. ADMIN is excluded here on purpose — it reaches the
  // full console from its own nav item, so also showing the desk subset inline
  // would duplicate the same controls.
  const canEditDeskSettings =
    !!session && session.role !== "ADMIN" && can(session.role, "settings.desk.write");

  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState<{
    name: string; phone: string; address: string; city: string; country: string;
    dateOfBirth: string; nationality: string;
  }>({
    name: "", phone: "", address: "", city: "", country: "", dateOfBirth: "", nationality: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [pushState, setPushState] = useState<"idle" | "on" | "off" | "busy" | "unsupported">("idle");
  const [erasureOpen, setErasureOpen] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [sessions, setSessions] = useState<Array<{ id: string; createdAt: string; expiresAt: string; current: boolean }>>([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);

  const loadSessions = useCallback(async () => {
    try {
      const res = await api.sessions();
      setSessions(res.sessions);
    } catch {
      /* non-critical — the block simply stays empty */
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadSessions);
  }, [loadSessions]);

  const signOutElsewhere = useCallback(async () => {
    setSessionsBusy(true);
    try {
      const res = await api.revokeOtherSessions();
      setSessions(res.sessions);
      toast({
        title: t("settings.signOutOthersDone", { n: res.revoked }),
      });
    } catch (e) {
      toast({ title: t("common.error"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSessionsBusy(false);
    }
  }, [loadSessions, t]);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      setLoading(true);
      try {
        const res = await api.profile();
        if (!alive) return;
        setProfile(res.profile);
        setForm({
          name: res.profile.name ?? "",
          phone: res.profile.phone ?? "",
          address: res.profile.address ?? "",
          city: res.profile.city ?? "",
          country: res.profile.country ?? "",
          dateOfBirth: res.profile.dateOfBirth ?? "",
          nationality: res.profile.nationality ?? "",
        });
      } catch {
        /* keep the empty form — save will surface errors */
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPushState("unsupported");
        return;
      }
      try {
        const status = await api.pushStatus();
        setPushState(status.subscribed ? "on" : "off");
      } catch {
        setPushState("off");
      }
    })();
  }, []);

  const saveProfile = useCallback(async () => {
    setSaving(true);
    try {
      const res = await api.updateProfile({
        name: form.name,
        phone: form.phone,
        address: form.address,
        city: form.city,
        country: form.country,
        dateOfBirth: form.dateOfBirth,
        nationality: form.nationality,
      });
      setProfile((p) => (p ? { ...p, ...res.profile } : p));
      toast({ title: t("settings.saved") });
    } catch (e) {
      toast({ title: t("common.error"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [form, t]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      toast({ title: t("common.error"), description: t("auth.passwordMismatch"), variant: "destructive" });
      return;
    }
    const policyKey = validatePassword(pw.next, pwMin);
    if (policyKey) {
      toast({ title: t("common.error"), description: t(policyKey as never, { min: pwMin }), variant: "destructive" });
      return;
    }
    setPwBusy(true);
    try {
      await api.changePassword(pw.current, pw.next);
      setPw({ current: "", next: "", confirm: "" });
      toast({ title: t("settings.passwordSaved") });
    } catch (err) {
      toast({ title: t("common.error"), description: describeAuthError(err, t).message, variant: "destructive" });
    } finally {
      setPwBusy(false);
    }
  }

  const exportData = useCallback(async () => {
    try {
      const data = await api.gdprExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `citizen-lane-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: t("settings.exportDone") });
    } catch (e) {
      toast({ title: t("common.error"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }, [t]);

  const requestErasure = useCallback(async () => {
    try {
      const res = await api.gdprErasure();
      setErasureOpen(false);
      toast({ title: t("settings.erasureDone"), description: res.note });
    } catch (e) {
      toast({ title: t("common.error"), description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }, [t]);

  async function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function togglePush() {
    if (pushState === "on") {
      setPushState("busy");
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api.pushUnsubscribe(sub.endpoint);
          await sub.unsubscribe();
        }
        setPushState("off");
        toast({ title: t("settings.pushOff") });
      } catch {
        setPushState("on");
        toast({ title: t("common.error"), variant: "destructive" });
      }
      return;
    }
    setPushState("busy");
    try {
      const status = await api.pushStatus();
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState("off");
        toast({ title: t("settings.pushDenied"), variant: "destructive" });
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: await urlBase64ToUint8Array(status.publicKey),
      });
      await api.pushSubscribe(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
      setPushState("on");
      toast({ title: t("settings.pushOn") });
    } catch (err) {
      setPushState("off");
      toast({ title: t("common.error"), description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  }

  const field = (key: keyof typeof form, labelKey: string, icon: React.ReactNode, type = "text") => (
    <div className="space-y-1.5">
      <Label htmlFor={`settings-${key}`}>{t(labelKey as never)}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden>{icon}</span>
        <Input
          id={`settings-${key}`}
          type={type}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
          className="pl-9"
          autoComplete="off"
        />
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-gold-ink">{t("settings.eyebrow")}</p>
          <h1 className="mt-1 font-editorial text-3xl text-cobble-ink">{t("settings.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {session?.email} · {session ? t(`role.${session.role}` as never) : ""}
          </p>
        </div>
      </div>

      {/* ── Experience, appearance & accessibility ──
          First section on purpose: what the app looks like and how much of it
          shows is the question a non-technical user actually has. */}
      <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="settings-appearance">
        <div className="flex items-center gap-2.5">
          <Palette className="h-4 w-4 text-gold-ink" aria-hidden />
          <h2 id="settings-appearance" className="font-editorial text-lg text-cobble-ink">
            {t("prefs.section.appearance")}
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("prefs.section.appearanceHint")}</p>

        <div className="mt-5 space-y-5">
          <Choice
            label={t("prefs.mode.label")}
            hint={t("prefs.mode.hint")}
            value={mode}
            onChange={(v) => setPrefs({ mode: v as UiMode })}
            options={[
              { value: "simple", label: t("prefs.mode.simple"), hint: t("prefs.mode.simpleHint") },
              { value: "advanced", label: t("prefs.mode.advanced"), hint: t("prefs.mode.advancedHint") },
            ]}
          />

          <Choice
            label={t("prefs.theme.label")}
            value={prefs.theme}
            onChange={(v) => setPrefs({ theme: v as ThemeChoice })}
            options={[
              { value: "light", label: t("prefs.theme.light"), icon: <Sun className="h-3.5 w-3.5" /> },
              { value: "dark", label: t("prefs.theme.dark"), icon: <Moon className="h-3.5 w-3.5" /> },
              { value: "system", label: t("prefs.theme.system"), icon: <Monitor className="h-3.5 w-3.5" /> },
            ]}
          />

          <Choice
            label={t("prefs.textSize.label")}
            value={prefs.textSize}
            onChange={(v) => setPrefs({ textSize: v as TextSize })}
            options={[
              { value: "default", label: t("prefs.textSize.default") },
              { value: "large", label: t("prefs.textSize.large") },
              { value: "xlarge", label: t("prefs.textSize.xlarge") },
            ]}
          />

          <Choice
            label={t("prefs.density.label")}
            value={prefs.density}
            onChange={(v) => setPrefs({ density: v as Density })}
            options={[
              { value: "comfortable", label: t("prefs.density.comfortable") },
              { value: "compact", label: t("prefs.density.compact") },
            ]}
          />

          <Toggle
            label={t("prefs.reduceMotion.label")}
            hint={t("prefs.reduceMotion.hint")}
            checked={prefs.reduceMotion}
            onChange={(v) => setPrefs({ reduceMotion: v })}
          />
          <Toggle
            label={t("prefs.highContrast.label")}
            hint={t("prefs.highContrast.hint")}
            checked={prefs.highContrast}
            onChange={(v) => setPrefs({ highContrast: v })}
          />

          <div className="flex justify-end">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => setPrefs({ mode: null, theme: "light", density: "comfortable", textSize: "default", reduceMotion: false, highContrast: false })}
            >
              {t("prefs.reset")}
            </Button>
          </div>
        </div>
      </section>

      {/* ── Profile ── */}
      <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="settings-profile">
        <div className="flex items-center gap-2.5">
          <UserRound className="h-4 w-4 text-gold-ink" aria-hidden />
          <h2 id="settings-profile" className="font-editorial text-lg text-cobble-ink">{t("settings.section.profile")}</h2>
        </div>
        {loading ? (
          <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> {t("common.loading")}
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {field("name", "settings.name", <UserRound className="h-4 w-4" />)}
              {field("phone", "settings.phone", <Phone className="h-4 w-4" />, "tel")}
              {field("address", "settings.address", <MapPin className="h-4 w-4" />)}
              {field("city", "settings.city", <Building2 className="h-4 w-4" />)}
              {field("country", "settings.country", <Globe className="h-4 w-4" />)}
              {field("dateOfBirth", "settings.dateOfBirth", <CalendarDays className="h-4 w-4" />, "date")}
              {field("nationality", "settings.nationality", <Globe className="h-4 w-4" />)}
              <div className="space-y-1.5">
                <Label htmlFor="settings-email">{t("settings.email")}</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden><Mail className="h-4 w-4" /></span>
                  <Input id="settings-email" value={profile?.email ?? session?.email ?? ""} disabled className="pl-9 text-muted-foreground" />
                </div>
                <p className="text-[11px] text-muted-foreground">{t("settings.emailHint")}</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button onClick={() => void saveProfile()} disabled={saving} className="min-h-11 bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]">
                {saving ? <Spinner className="mr-2 h-3 w-3" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {t("settings.save")}
              </Button>
            </div>
          </>
        )}
      </section>

      {/* ── Notifications ── */}
            <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="settings-notifications">
              <div className="flex items-center gap-2.5">
                <BellRing className="h-4 w-4 text-gold-ink" aria-hidden />
                <h2 id="settings-notifications" className="font-editorial text-lg text-cobble-ink">{t("settings.section.notifications")}</h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{t("settings.notifHint")}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => setPrefsOpen(true)} className="min-h-11">
                  {t("settings.notifOpen")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void togglePush()}
                  disabled={pushState === "busy" || pushState === "unsupported"}
                  className={cn("min-h-11", pushState === "on" && "border-olive/50 text-olive-ink")}
                >
                  {pushState === "busy" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : pushState === "on" ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <BellRing className="mr-2 h-4 w-4" />}
                  {pushState === "on" ? t("settings.pushDisable") : t("settings.pushEnable")}
                </Button>
              </div>
            </section>
      
            {/* ── Calls & chat ── */}
            <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="settings-calls-chat">
              <div className="flex items-center gap-2.5">
                <div className="inline-flex h-6 w-6 items-center justify-center rounded bg-gold/15 text-gold-ink">
                  <Video className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <h2 id="settings-calls-chat" className="font-editorial text-lg text-cobble-ink">{t("call.settings.title")} & {t("team.settings.title")}</h2>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{t("settings.callsChatHint")}</p>
              <div className="mt-4 space-y-3">
                <Button variant="outline" onClick={() => setPrefsOpen(true)} className="min-h-11 w-full sm:w-auto">
                  {t("settings.notifOpen")}
                </Button>
              </div>
            </section>
      
            {/* ── Language ── */}
      <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="settings-language">
        <div className="flex items-center gap-2.5">
          <Globe className="h-4 w-4 text-gold-ink" aria-hidden />
          <h2 id="settings-language" className="font-editorial text-lg text-cobble-ink">{t("settings.section.language")}</h2>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={t("settings.section.language")}>
          {LOCALES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => { setLocale(l.code as Locale); toast({ title: t("settings.saved") }); }}
              aria-pressed={locale === l.code}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm font-medium transition-colors",
                locale === l.code ? "border-gold bg-gold text-cobble-ink" : "border-border text-muted-foreground hover:border-gold/60 hover:text-cobble-ink"
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>

      {/* ── Mobile app ── */}
      <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="settings-mobile">
        <div className="flex items-center gap-2.5">
          <Smartphone className="h-4 w-4 text-gold-ink" aria-hidden />
          <h2 id="settings-mobile" className="font-editorial text-lg text-cobble-ink">{t("settings.section.install")}</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("settings.installHint")}</p>
        {/* A real one-tap install when the browser offers a prompt; the manual
            steps below stay as the path iOS Safari requires (it has no prompt
            API), so neither case shows a button that cannot work. */}
        {installed ? (
          <p className="mt-4 inline-flex items-center gap-2 text-sm text-olive-ink">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t("settings.installDone")}
          </p>
        ) : canInstall ? (
          <div className="mt-4">
            <Button variant="outline" onClick={() => void install()} className="min-h-11">
              <Download className="mr-2 h-4 w-4" /> {t("pwa.installCta")}
            </Button>
          </div>
        ) : null}
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          <li>· iOS Safari: {t("pwa.iosStep1")} → {t("pwa.iosStep2")}</li>
          <li>· Android / Chrome: ⋮ menu → {t("pwa.installCta")}</li>
        </ul>
      </section>

      {/* ── Security ── */}
      <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="settings-security">
        <div className="flex items-center gap-2.5">
          <KeyRound className="h-4 w-4 text-gold-ink" aria-hidden />
          <h2 id="settings-security" className="font-editorial text-lg text-cobble-ink">{t("settings.section.security")}</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("settings.securityHint")}</p>
        <form className="mt-4 grid max-w-md gap-4" aria-label={t("settings.changePassword")} onSubmit={submitPassword}>
          <div className="space-y-1.5">
            <Label htmlFor="settings-current-password">{t("settings.currentPassword")}</Label>
            <Input
              id="settings-current-password"
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw((f) => ({ ...f, current: e.target.value }))}
              required
              className="min-h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-new-password">{t("auth.newPassword")}</Label>
            <Input
              id="settings-new-password"
              type="password"
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw((f) => ({ ...f, next: e.target.value }))}
              required
              className="min-h-11"
            />
            <p className="text-[11px] text-muted-foreground">{t("settings.passwordHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-confirm-password">{t("auth.confirmPassword")}</Label>
            <Input
              id="settings-confirm-password"
              type="password"
              autoComplete="new-password"
              value={pw.confirm}
              onChange={(e) => setPw((f) => ({ ...f, confirm: e.target.value }))}
              required
              className="min-h-11"
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={pwBusy} className="min-h-11 bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]">
              {pwBusy ? <Spinner className="mr-2 h-3 w-3" /> : <KeyRound className="mr-2 h-4 w-4" />}
              {t("settings.changePassword")}
            </Button>
          </div>
        </form>

        {/* Where you are still signed in — admins could revoke sessions but a
            person could not see or end their own. */}
        <div className="mt-6 border-t border-border pt-5">
          <p className="text-sm font-medium text-cobble-ink">{t("settings.sessionsTitle")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("settings.sessionsHint")}</p>
          {sessions.length > 0 && (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border">
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                  <span className="text-iron-ink">
                    {new Date(s.createdAt).toLocaleString()}
                  </span>
                  <span className="flex items-center gap-2">
                    {s.current && (
                      <span className="rounded-full bg-olive/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-olive-ink">
                        {t("settings.sessionThisDevice")}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => void signOutElsewhere()}
              disabled={sessionsBusy}
            >
              {sessionsBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("settings.signOutOthers")}
            </Button>
          </div>
        </div>
      </section>

      {/* ── Privacy & data ── */}
      <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="settings-privacy">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-gold-ink" aria-hidden />
          <h2 id="settings-privacy" className="font-editorial text-lg text-cobble-ink">{t("settings.section.privacy")}</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{t("settings.privacyHint")}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void exportData()} className="min-h-11">
            <Download className="mr-2 h-4 w-4" /> {t("settings.exportCta")}
          </Button>
          <Button variant="outline" onClick={() => setErasureOpen(true)} className="min-h-11 text-danger-ink hover:text-danger-ink">
            {t("settings.erasureCta")}
          </Button>
        </div>
      </section>

      {/* ── Desk settings (RM / SENIOR_RM) ──
          The desk may READ operations + rm but, before this, could not edit the
          settings governing its own desk without an admin. Reuses the admin
          console's editor, scoped to the sections this role may write. */}
      {canEditDeskSettings && (
        <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="settings-desk">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="h-4 w-4 text-gold-ink" aria-hidden />
            <h2 id="settings-desk" className="font-editorial text-lg text-cobble-ink">{t("nav.platformSettings")}</h2>
          </div>
          <div className="mt-4">
            <DeskPlatformSettings />
          </div>
        </section>
      )}

      {/* ── Integrations (ADMIN) ── */}
      {session?.role === "ADMIN" && (
        <section className="rounded-md border border-border bg-card p-5 md:p-6" aria-labelledby="settings-integrations">
          <div className="flex items-center gap-2.5">
            <Building2 className="h-4 w-4 text-gold-ink" aria-hidden />
            <h2 id="settings-integrations" className="font-editorial text-lg text-cobble-ink">{t("settings.section.integrations")}</h2>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("settings.integrationsHint")}</p>
          <div className="mt-4">
            <Button variant="outline" onClick={() => setView("admin-automation")} className="min-h-11">
              {t("settings.integrationsOpen")}
            </Button>
          </div>
        </section>
      )}

      <NotificationPrefsDialog open={prefsOpen} onOpenChange={setPrefsOpen} />

      <AlertDialog open={erasureOpen} onOpenChange={setErasureOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-editorial text-cobble-ink">{t("settings.erasureTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.erasureBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void requestErasure()} className="min-h-11 bg-[#b04a48] text-[#F5F1EA] hover:bg-[#b04a48]/90">
              {t("settings.erasureConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** A labelled row of mutually exclusive pills — the shape every appearance
 *  preference takes, so each one is a single call rather than bespoke markup. */
function Choice({
  label,
  hint,
  value,
  onChange,
  options,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; hint?: string; icon?: React.ReactNode }>;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-cobble-ink">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            title={o.hint}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
              value === o.value
                ? "border-gold bg-gold text-cobble-ink"
                : "border-border text-muted-foreground hover:border-gold/60 hover:text-cobble-ink",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A labelled switch row. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-cobble-ink">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}
