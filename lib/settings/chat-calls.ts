"use client";

/**
 * Unified chat & call settings — single source of truth for all
 * real-time communication preferences. Replaces the scattered prefs in
 * notification-prefs-dialog.tsx, call-center.tsx and teams-view.tsx.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useI18n, LOCALES, type Locale } from "@/lib/i18n";
import { useApp } from "@/lib/store";

const PREF_CATEGORIES = ["CASE", "DOCUMENT", "SYSTEM"] as const;
type PrefCategory = (typeof PREF_CATEGORIES)[number];
type ChannelKey = "inApp" | "email" | "push";

const PREF_CHANNELS: Array<{ key: ChannelKey; labelKey: string }> = [
  { key: "inApp", labelKey: "notifications.channel.inApp" },
  { key: "email", labelKey: "notifications.channel.email" },
  { key: "push", labelKey: "notifications.channel.push" },
];

const PREF_CATEGORY_LABEL_KEYS: Record<PrefCategory, string> = {
  CASE: "notifications.category.CASE",
  DOCUMENT: "notifications.category.DOCUMENT",
  SYSTEM: "notifications.category.SYSTEM",
};

const DEFAULT_CATEGORY_PREFS: Record<PrefCategory, Record<ChannelKey, boolean>> = {
  CASE: { inApp: true, push: true, email: true },
  DOCUMENT: { inApp: true, push: true, email: false },
  SYSTEM: { inApp: true, push: false, email: false },
};

export type ChatCallPrefs = {
  /** Per-category × channel notification matrix */
  categoryPrefs: Record<PrefCategory, Record<ChannelKey, boolean>>;
  /** Quiet hours window (HH:mm-HH:mm) */
  quietHours: string;
  /** Per-user interface language override */
  locale: Locale;
  /** Call-specific preferences */
  callPrefs: {
    /** Auto-start live transcription when a call connects */
    transcription: boolean;
    /** Request recording consent from the counterparty */
    recording: boolean;
    /** Default call kind when starting a new call */
    defaultKind: "AUDIO" | "VIDEO";
    /** Subtitle translation target language */
    subtitleLang: Locale;
  };
  /** Team chat preferences */
  chatPrefs: {
    /** Show voice note button in team chat */
    voiceNotes: boolean;
    /** Auto-play incoming voice notes */
    autoPlayVoice: boolean;
    /** Show live captions during team voice playback */
    captions: boolean;
  };
};

const DEFAULT_PREFS: ChatCallPrefs = {
  categoryPrefs: DEFAULT_CATEGORY_PREFS,
  quietHours: "22:00-07:00",
  locale: "en",
  callPrefs: {
    transcription: false,
    recording: false,
    defaultKind: "AUDIO",
    subtitleLang: "en",
  },
  chatPrefs: {
    voiceNotes: true,
    autoPlayVoice: false,
    captions: true,
  },
};

export function useChatCallSettings() {
  const { t, locale, setLocale } = useI18n();
  const session = useApp((s) => s.session);
  const [prefs, setPrefs] = useState<ChatCallPrefs>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const res = await api.notifications();
      const stored = res.prefs;
      if (!stored) return;

      const merged: ChatCallPrefs = { ...DEFAULT_PREFS };

      if (stored.categoryPrefs) {
        try {
          const parsed = JSON.parse(stored.categoryPrefs) as Partial<Record<PrefCategory, Partial<Record<ChannelKey, boolean>>>>;
          for (const cat of PREF_CATEGORIES) {
            const p = parsed[cat];
            if (p) {
              merged.categoryPrefs[cat] = {
                inApp: p.inApp ?? merged.categoryPrefs[cat].inApp,
                email: p.email ?? merged.categoryPrefs[cat].email,
                push: p.push ?? merged.categoryPrefs[cat].push,
              };
            }
          }
        } catch { /* malformed JSON */ }
      }

      if (stored.quietHours) merged.quietHours = stored.quietHours;
      if (stored.locale && LOCALES.some((l) => l.code === stored.locale)) {
        merged.locale = stored.locale as Locale;
      }

      if (stored.callPrefs) {
        try {
          const cp = JSON.parse(stored.callPrefs) as Partial<ChatCallPrefs["callPrefs"]>;
          merged.callPrefs = { ...merged.callPrefs, ...cp };
        } catch { /* malformed JSON */ }
      }

      if (stored.chatPrefs) {
        try {
          const cp = JSON.parse(stored.chatPrefs) as Partial<ChatCallPrefs["chatPrefs"]>;
          merged.chatPrefs = { ...merged.chatPrefs, ...cp };
        } catch { /* malformed JSON */ }
      }

      setPrefs(merged);
    } catch { /* silent — keep defaults */ }
    finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api.savePrefs({
        categoryPrefs: prefs.categoryPrefs,
        quietHours: prefs.quietHours,
        locale: prefs.locale,
        callPrefs: prefs.callPrefs,
        chatPrefs: prefs.chatPrefs,
      });
      setLocale(prefs.locale);
    } catch (e) {
      console.error("[chat-calls] save failed", e);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [prefs, setLocale]);

  const updateCategoryPref = useCallback(<K extends ChannelKey>(cat: PrefCategory, channel: K, value: boolean) => {
    setPrefs((p) => ({ ...p, categoryPrefs: { ...p.categoryPrefs, [cat]: { ...p.categoryPrefs[cat], [channel]: value } } }));
  }, []);

  const updateCallPref = useCallback(<K extends keyof ChatCallPrefs["callPrefs"]>(key: K, value: ChatCallPrefs["callPrefs"][K]) => {
    setPrefs((p) => ({ ...p, callPrefs: { ...p.callPrefs, [key]: value } }));
  }, []);

  const updateChatPref = useCallback(<K extends keyof ChatCallPrefs["chatPrefs"]>(key: K, value: ChatCallPrefs["chatPrefs"][K]) => {
    setPrefs((p) => ({ ...p, chatPrefs: { ...p.chatPrefs, [key]: value } }));
  }, []);

  const updateQuietHours = useCallback((value: string) => {
    setPrefs((p) => ({ ...p, quietHours: value }));
  }, []);

  const updateLocale = useCallback((value: Locale) => {
    setPrefs((p) => ({ ...p, locale: value }));
  }, []);

  return {
    prefs,
    loading,
    saving,
    load,
    save,
    updateCategoryPref,
    updateCallPref,
    updateChatPref,
    updateQuietHours,
    updateLocale,
    t,
    locale,
    LOCALES,
  };
}

/** Speech engine availability (for feature detection in UI) */
export type SpeechEngine = "whisper" | "web-speech" | "none";

export function detectSpeechEngine(): SpeechEngine {
  if (typeof window === "undefined") return "none";
  const w = window as unknown as {
    SpeechRecognition?: new () => unknown;
    webkitSpeechRecognition?: new () => unknown;
  };
  // Scribe (Whisper via Transformers.js) availability is checked dynamically
  // in the hook — here we only know about Web Speech API.
  return w.SpeechRecognition || w.webkitSpeechRecognition ? "web-speech" : "none";
}

/** Call kinds supported by the platform */
export const CALL_KINDS = ["AUDIO", "VIDEO"] as const;
export type CallKind = (typeof CALL_KINDS)[number];

/** Team kinds supported by the platform */
export const TEAM_KINDS = ["TEAM", "COMMITTEE", "POD"] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];