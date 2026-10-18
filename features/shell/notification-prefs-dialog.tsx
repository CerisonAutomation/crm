"use client";

/**
 * Unified notification + call + chat preferences dialog.
 * Replaces the old category×channel matrix with the shared settings module.
 */

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useI18n, LOCALES, type Locale, type StringKey } from "@/lib/i18n";
import { Spinner } from "@/components/brand/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { QUIET_HOURS_PATTERN } from "@/lib/settings/registry";
import { usePlatformSettings } from "@/lib/settings/client";
import { toast } from "@/hooks/use-toast";
import { useChatCallSettings, type ChatCallPrefs, type CallKind, type TeamKind } from "@/lib/settings/chat-calls";
import { CheckCircle2, Mic, Sparkles, Video } from "lucide-react";

const PREF_CATEGORIES = ["CASE", "DOCUMENT", "SYSTEM"] as const;
type PrefCategory = (typeof PREF_CATEGORIES)[number];
type ChannelKey = "inApp" | "email" | "push";

const PREF_CHANNELS: Array<{ key: ChannelKey; labelKey: StringKey }> = [
  { key: "inApp", labelKey: "notifications.channel.inApp" },
  { key: "email", labelKey: "notifications.channel.email" },
  { key: "push", labelKey: "notifications.channel.push" },
];

const PREF_CATEGORY_LABEL_KEYS: Record<PrefCategory, StringKey> = {
  CASE: "notifications.category.CASE",
  DOCUMENT: "notifications.category.DOCUMENT",
  SYSTEM: "notifications.category.SYSTEM",
};

const CALL_KINDS: Array<{ value: CallKind; labelKey: StringKey; icon: React.ReactNode }> = [
  { value: "AUDIO", labelKey: "call.audio", icon: <Mic className="h-3.5 w-3.5" /> },
  { value: "VIDEO", labelKey: "call.video", icon: <Video className="h-3.5 w-3.5" /> },
];

export function NotificationPrefsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale, setLocale } = useI18n();
  const { settings } = usePlatformSettings();
  const quietHoursDefault = settings.governance.quietHoursDefault;

  const {
      prefs,
      loading,
      saving,
      load,
      updateCategoryPref,
      updateCallPref,
      updateChatPref,
      updateQuietHours,
      updateLocale,
      save,
    } = useChatCallSettings();
  
    const [quietHours, setQuietHours] = useState(prefs.quietHours);
    const [prefLocale, setPrefLocale] = useState<Locale>(prefs.locale);
    const [quietInvalid, setQuietInvalid] = useState(false);
  
    // Re-seed the local draft when the shared hook loads new values (the
    // dialog reopening, or a fresh fetch). Compared field-by-field because
    // `prefs` is a fresh object every render; adjusting during render keeps
    // the draft in step without the extra commit an effect would cost.
    const [seeded, setSeeded] = useState({
      quietHours: prefs.quietHours,
      locale: prefs.locale,
    });
    if (seeded.quietHours !== prefs.quietHours || seeded.locale !== prefs.locale) {
      setSeeded({ quietHours: prefs.quietHours, locale: prefs.locale });
      setQuietHours(prefs.quietHours);
      setPrefLocale(prefs.locale);
    }
  
    // Load stored prefs each time the dialog opens
    useEffect(() => {
      if (!open) return;
      void load();
    }, [open, load]);

  async function handleSave() {
    const qh = quietHours.trim();
    if (!QUIET_HOURS_PATTERN.test(qh)) {
      setQuietInvalid(true);
      return;
    }
    setQuietInvalid(false);
    try {
      await save();
      setLocale(prefLocale);
      toast({ title: t("notifications.prefsSaved") });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: t("common.error"),
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-editorial text-cobble-ink">{t("notifications.preferences")}</DialogTitle>
          <DialogDescription>{t("notifications.prefsIntro")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
            <Spinner className="h-5 w-5" />
            <span>{t("common.loading")}</span>
          </div>
        ) : (
          <>
            {/* ── category × channel matrix ── */}
            <section className="space-y-4" aria-labelledby="notif-matrix-heading">
              <h3 id="notif-matrix-heading" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t("notifications.title")}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[300px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="pb-2 pr-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {t("notifications.title")}
                      </th>
                      {PREF_CHANNELS.map((c) => (
                        <th key={c.key} scope="col" className="pb-2 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          {t(c.labelKey)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PREF_CATEGORIES.map((cat) => (
                      <tr key={cat}>
                        <th scope="row" className="border-t border-border/60 py-3 pr-3 text-left align-middle font-medium text-cobble-ink">
                          {t(PREF_CATEGORY_LABEL_KEYS[cat])}
                        </th>
                        {PREF_CHANNELS.map((c) => (
                          <td key={c.key} className="border-t border-border/60 py-3 text-center align-middle">
                            <Switch
                              className="mx-auto"
                              checked={prefs.categoryPrefs[cat][c.key]}
                              onCheckedChange={(v) => updateCategoryPref(cat, c.key, v)}
                              aria-label={`${t(PREF_CATEGORY_LABEL_KEYS[cat])} — ${t(c.labelKey)}`}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/* ── quiet hours + language ── */}
            <section className="space-y-4 grid gap-4 sm:grid-cols-2" aria-labelledby="notif-qh-heading">
              <h3 id="notif-qh-heading" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t("notifications.quietHoursAndLang")}
              </h3>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="prefs-quiet-hours">{t("notifications.quietHours")}</Label>
                <Input
                  id="prefs-quiet-hours"
                  value={quietHours}
                  onChange={(e) => { updateQuietHours(e.target.value); setQuietHours(e.target.value); setQuietInvalid(false); }}
                  placeholder={quietHoursDefault}
                  pattern="\\d{2}:\\d{2}-\\d{2}:\\d{2}"
                  autoComplete="off"
                  aria-invalid={quietInvalid || undefined}
                  aria-describedby="prefs-quiet-hours-help"
                  className={cn("rounded-none border-input focus-visible:ring-gold", quietInvalid && "border-coral/60 focus-visible:ring-coral/40")}
                />
                <p id="prefs-quiet-hours-help" className="text-[11px] leading-relaxed text-muted-foreground">
                  {t("notifications.quietHoursHelp")}
                </p>
                {quietInvalid && (
                  <p role="alert" className="text-[11px] font-medium text-danger-ink">
                    {t("notifications.quietHoursInvalid")}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prefs-locale">{t("common.language")}</Label>
                <Select value={prefLocale} onValueChange={(v) => { updateLocale(v as Locale); setPrefLocale(v as Locale); }}>
                  <SelectTrigger id="prefs-locale" className="w-full" aria-label={t("common.language")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOCALES.map((l) => (
                      <SelectItem key={l.code} value={l.code}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </section>

            {/* ── call settings ── */}
            <section className="space-y-4 rounded-md border border-border/60 p-3" aria-labelledby="call-settings-heading">
              <h3 id="call-settings-heading" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-gold/15 text-gold-ink">
                  <Video className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {t("call.settings.title")}
              </h3>

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-cobble-ink">{t("call.settings.transcription")}</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t("call.settings.transcriptionHelp")}</p>
                  </div>
                  <Switch
                    checked={prefs.callPrefs.transcription}
                    onCheckedChange={(v) => updateCallPref("transcription", v)}
                    aria-label={t("call.settings.transcription")}
                  />
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-cobble-ink">{t("call.settings.recording")}</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t("call.settings.recordingHelp")}</p>
                  </div>
                  <Switch
                    checked={prefs.callPrefs.recording}
                    onCheckedChange={(v) => updateCallPref("recording", v)}
                    aria-label={t("call.settings.recording")}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="prefs-default-call-kind">{t("call.settings.defaultKind")}</Label>
                  <Select value={prefs.callPrefs.defaultKind} onValueChange={(v) => updateCallPref("defaultKind", v as CallKind)}>
                    <SelectTrigger id="prefs-default-call-kind" className="w-full" aria-label={t("call.settings.defaultKind")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CALL_KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          <span className="flex items-center gap-2">
                            {k.icon}
                            {t(k.labelKey)}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="prefs-subtitle-lang">{t("call.settings.subtitleLang")}</Label>
                  <Select value={prefs.callPrefs.subtitleLang} onValueChange={(v) => updateCallPref("subtitleLang", v as Locale)}>
                    <SelectTrigger id="prefs-subtitle-lang" className="w-full" aria-label={t("call.settings.subtitleLang")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOCALES.map((l) => (
                        <SelectItem key={l.code} value={l.code}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            {/* ── chat / team settings ── */}
            <section className="space-y-4 rounded-md border border-border/60 p-3" aria-labelledby="chat-settings-heading">
              <h3 id="chat-settings-heading" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-gold/15 text-gold-ink">
                  <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                {t("team.settings.title")}
              </h3>

              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-cobble-ink">{t("team.settings.voiceNotes")}</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t("team.settings.voiceNotesHelp")}</p>
                  </div>
                  <Switch
                    checked={prefs.chatPrefs.voiceNotes}
                    onCheckedChange={(v) => updateChatPref("voiceNotes", v)}
                    aria-label={t("team.settings.voiceNotes")}
                  />
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-cobble-ink">{t("team.settings.autoPlayVoice")}</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t("team.settings.autoPlayVoiceHelp")}</p>
                  </div>
                  <Switch
                    checked={prefs.chatPrefs.autoPlayVoice}
                    onCheckedChange={(v) => updateChatPref("autoPlayVoice", v)}
                    aria-label={t("team.settings.autoPlayVoice")}
                  />
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-cobble-ink">{t("team.settings.captions")}</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">{t("team.settings.captionsHelp")}</p>
                  </div>
                  <Switch
                    checked={prefs.chatPrefs.captions}
                    onCheckedChange={(v) => updateChatPref("captions", v)}
                    aria-label={t("team.settings.captions")}
                  />
                </div>
              </div>
            </section>
          </>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            className="bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]"
            onClick={() => void handleSave()}
            disabled={saving || loading}
          >
            {saving && <Spinner className="mr-2 h-3 w-3" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}