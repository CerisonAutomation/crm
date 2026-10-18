"use client";
/**
 * Platform Settings — ONE generic editor driven ENTIRELY by the settings
 * registry (src/lib/settings/registry.ts). One card per section: per-field
 * inputs chosen by the registry field type (string → Input, string[]/number[] →
 * a repeater, stringMap → one Input per canon key), a per-section Save
 * (api.saveSettingsSection) and a per-section "Reset to defaults" behind an
 * AlertDialog (api.resetSettingsSection). Every write is authorized server-side
 * (the section's writeCapability + the section's writeRoles) and audited.
 *
 * TWO entry points, ONE implementation:
 *   - `AdminPlatformSettings` (variant "admin") — the full console, every
 *     section, reached from the ADMIN-only nav. Save is always permitted (ADMIN
 *     holds the wildcard).
 *   - `DeskPlatformSettings` (variant "desk") — the SAME editor, but limited to
 *     the sections the caller's role may WRITE (`canWriteSection`: operations +
 *     rm for RM/SENIOR_RM). It renders no page chrome, so the personal Settings
 *     view can drop it into its own section without a second settings UI. A
 *     section the role cannot write is never rendered, so a desk user is never
 *     offered a Save button that would 403.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import {
  DEFAULT_PLATFORM_SETTINGS,
  SETTINGS_SECTIONS,
  canWriteSection,
  type PlatformSettings,
  type SettingsField,
  type SettingsSection,
} from "@/lib/settings/registry";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { BrandLoader, Eyebrow, SectionTitle, Spinner } from "@/components/brand/ui";
import { toast } from "@/hooks/use-toast";
import { Plus, RefreshCcw, RotateCcw, Trash2 } from "lucide-react";

// ── Draft shapes (form state) ───────────────────────────────────────────────

type DraftValue = string | number | string[] | number[] | Record<string, string> | Record<string, number>;
type SectionDraft = Record<string, DraftValue>;
type Drafts = Record<string, SectionDraft>;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : "Unknown error");

function cloneValue(v: DraftValue): DraftValue {
  if (Array.isArray(v)) return [...v] as DraftValue;
  // A plain object draft (stringMap / numberMap) must be copied too, or editing
  // a field would mutate the settings object the form was seeded from.
  if (v && typeof v === "object") return { ...(v as Record<string, unknown>) } as DraftValue;
  return v;
}

/** Seed every section's draft from the server settings, canon underneath. */
function seedDrafts(settings: Partial<PlatformSettings> | undefined): Drafts {
  const src = (settings ?? {}) as Record<string, Record<string, DraftValue> | undefined>;
  const canon = DEFAULT_PLATFORM_SETTINGS as unknown as Record<string, Record<string, DraftValue>>;
  const drafts: Drafts = {};
  for (const section of SETTINGS_SECTIONS) {
    const draft: SectionDraft = {};
    for (const field of section.fields) {
      draft[field.key] = cloneValue(src[section.key]?.[field.key] ?? canon[section.key][field.key]);
    }
    drafts[section.key] = draft;
  }
  return drafts;
}

// ── Surface ─────────────────────────────────────────────────────────────────

/** ADMIN console: the full page, every section. */
export function AdminPlatformSettings() {
  return <PlatformSettingsEditor variant="admin" />;
}

/**
 * Desk variant: the same controls, limited to the sections the caller's role
 * may write. Rendered inside the personal Settings view for RM/SENIOR_RM.
 */
export function DeskPlatformSettings() {
  return <PlatformSettingsEditor variant="desk" />;
}

function PlatformSettingsEditor({ variant }: { variant: "admin" | "desk" }) {
  const role = useApp((s) => s.session?.role ?? "");
  // Deny-by-default, matching the route: only sections this role may actually
  // write are rendered, so no Save button can ever 403.
  const sections = useMemo(() => SETTINGS_SECTIONS.filter((s) => canWriteSection(role, s)), [role]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.platformSettings();
      setDrafts(seedDrafts(res.settings));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setField = useCallback((sectionKey: string, fieldKey: string, value: DraftValue) => {
    setDrafts((d) => ({ ...d, [sectionKey]: { ...d[sectionKey], [fieldKey]: value } }));
  }, []);

  async function saveSection(section: SettingsSection) {
    setBusyKey(`save:${section.key}`);
    try {
      const res = await api.saveSettingsSection(section.key, drafts[section.key]);
      setDrafts(seedDrafts(res.settings));
      toast({ title: "Settings saved", description: `${section.title} updated.` });
    } catch (e) {
      toast({ title: "Save failed", description: errMsg(e), variant: "destructive" });
    } finally {
      setBusyKey(null);
    }
  }

  async function resetSection(section: SettingsSection) {
    setBusyKey(`reset:${section.key}`);
    try {
      const res = await api.resetSettingsSection(section.key);
      setDrafts(seedDrafts(res.settings));
      toast({ title: "Reset to defaults", description: `${section.title} reverted to canon.` });
    } catch (e) {
      toast({ title: "Reset failed", description: errMsg(e), variant: "destructive" });
    } finally {
      setBusyKey(null);
    }
  }

  // ── generic field renderer (driven only by the registry) ──

  function renderField(section: SettingsSection, field: SettingsField, draft: SectionDraft) {
    const value = draft[field.key];
    const idBase = `${section.key}-${field.key}`;

    if (field.type === "string") {
      return (
        <div className="space-y-1.5">
          <Label htmlFor={idBase}>{field.label}</Label>
          <Input id={idBase} className="min-h-11 sm:min-h-0" value={value as string} onChange={(e) => setField(section.key, field.key, e.target.value)} />
          {field.help && <p className="text-[11px] leading-relaxed text-muted-foreground">{field.help}</p>}
        </div>
      );
    }

    if (field.type === "number") {
      return (
        <div className="space-y-1.5">
          <Label htmlFor={idBase}>{field.label}</Label>
          <Input
            id={idBase}
            type="number"
            min={field.min}
            max={field.max}
            value={String(value ?? "")}
            className="w-40 min-h-11 sm:min-h-0"
            onChange={(e) => setField(section.key, field.key, e.target.value === "" ? 0 : Number(e.target.value))}
          />
          {field.help && <p className="text-[11px] leading-relaxed text-muted-foreground">{field.help}</p>}
        </div>
      );
    }

    if (field.type === "stringMap") {
      const canonMap = (DEFAULT_PLATFORM_SETTINGS as unknown as Record<string, Record<string, Record<string, string>>>)[section.key][field.key];
      const map = value as Record<string, string>;
      return (
        <div className="space-y-2">
          <Label>{field.label}</Label>
          {field.help && <p className="text-[11px] leading-relaxed text-muted-foreground">{field.help}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.keys(canonMap).map((key) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`${idBase}-${key}`} className="font-mono text-[11px] text-iron-ink">{key}</Label>
                <Input
                  id={`${idBase}-${key}`}
                  className="min-h-11 sm:min-h-0"
                  value={map[key] ?? ""}
                  placeholder={canonMap[key]}
                  onChange={(e) => setField(section.key, field.key, { ...map, [key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (field.type === "numberMap") {
      const canonMap = (DEFAULT_PLATFORM_SETTINGS as unknown as Record<string, Record<string, Record<string, number>>>)[section.key][field.key];
      const map = value as unknown as Record<string, number>;
      return (
        <div className="space-y-2">
          <Label>{field.label}</Label>
          {field.help && <p className="text-[11px] leading-relaxed text-muted-foreground">{field.help}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.keys(canonMap).map((key) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`${idBase}-${key}`} className="font-mono text-[11px] text-iron-ink">{key}</Label>
                <Input
                  id={`${idBase}-${key}`}
                  type="number"
                  className="min-h-11 sm:min-h-0"
                  min={field.min}
                  max={field.max}
                  value={String(map[key] ?? canonMap[key])}
                  onChange={(e) => setField(section.key, field.key, { ...map, [key]: e.target.value === "" ? canonMap[key] : Number(e.target.value) })}
                />
              </div>
            ))}
          </div>
        </div>
      );
    }

    // string[] / number[]
    const list = value as Array<string | number>;
    const isNumber = field.type === "number[]";
    const updateAt = (i: number, raw: string) =>
      setField(
        section.key,
        field.key,
        list.map((item, j) => (j === i ? (isNumber ? (raw === "" ? 0 : Number(raw)) : raw) : item)) as string[] | number[],
      );
    const addItem = () => setField(section.key, field.key, [...list, isNumber ? 4 : ""] as string[] | number[]);
    const removeItem = (i: number) =>
      setField(section.key, field.key, list.filter((_, j) => j !== i) as string[] | number[]);

    return (
      <div className="space-y-2">
        <Label>{field.label}</Label>
        {field.help && <p className="text-[11px] leading-relaxed text-muted-foreground">{field.help}</p>}
        <div className="space-y-2">
          {list.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`${field.label} ${i + 1}`}
                value={String(item)}
                inputMode={isNumber ? "numeric" : undefined}
                className="min-w-0 flex-1 min-h-11 sm:min-h-0"
                onChange={(e) => updateAt(i, e.target.value)}
              />
              <Button variant="ghost" size="icon" aria-label={`Remove ${field.label} ${i + 1}`} onClick={() => removeItem(i)}>
                <Trash2 className="h-4 w-4 text-danger-ink" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={addItem}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add
        </Button>
      </div>
    );
  }

  if (loading) {
    return variant === "admin" ? (
      <div className="flex min-h-[60vh] items-center justify-center">
        <BrandLoader size={112} />
      </div>
    ) : (
      <div className="flex items-center gap-3 py-8 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }

  if (error) {
    const retry = (
      <Card className="rounded-md border-coral/50 bg-coral/5 p-6">
        <p className="text-sm font-semibold text-danger-ink">Could not load platform settings</p>
        <p className="mt-1 text-sm text-iron-ink">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
          <RefreshCcw className="mr-2 h-3.5 w-3.5" /> Retry
        </Button>
      </Card>
    );
    return variant === "admin" ? <div className="mx-auto max-w-5xl px-5 py-10 md:px-8">{retry}</div> : retry;
  }

  const busy = busyKey !== null;

  const cards = sections.map((section) => (
    <Card key={section.key} className="gap-0 rounded-md border-border p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{section.title}</Eyebrow>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{section.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset {section.title} to defaults?</AlertDialogTitle>
                <AlertDialogDescription>
                  Any edited values in this section are discarded and the canon defaults are restored. This
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => { e.preventDefault(); void resetSection(section); }}>
                  Reset to defaults
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            size="sm"
            className="bg-cobble text-[#F5F1EA] hover:bg-[#1B3A54]"
            disabled={busy}
            onClick={() => void saveSection(section)}
          >
            {busy && <Spinner className="mr-2 h-3 w-3" />} Save
          </Button>
        </div>
      </div>
      <div className="mt-5 space-y-5">
        {section.fields.map((field) => (
          <div key={field.key}>{renderField(section, field, drafts[section.key])}</div>
        ))}
      </div>
    </Card>
  ));

  // Desk variant renders no page chrome — the Settings view supplies the section
  // wrapper and heading, so this is the same control set, not a second UI.
  if (variant === "desk") {
    return <div className="space-y-6">{cards}</div>;
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 md:px-8">
      <div className="mb-8">
        <Eyebrow>Administration</Eyebrow>
        <SectionTitle className="mt-1.5">Platform Settings</SectionTitle>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          The last hardcoded business copy and operational data in one place. Edits take effect immediately across the
          app, the client portal and every generated PDF. All changes are recorded in the audit trail.
        </p>
      </div>
      <div className="space-y-6">{cards}</div>
    </div>
  );
}
