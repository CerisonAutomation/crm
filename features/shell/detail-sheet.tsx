"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/brand/sheet";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  X as Close,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";

const GUTTER = "px-5";

export const SECTION_TITLE =
  "font-medium text-muted-foreground text-xs uppercase tracking-wider";

export const PROPERTY_ROW = "grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2";

export const PROPERTY_LABEL = "truncate text-muted-foreground text-xs";

const PROPERTY_CELL = "border border-transparent py-1";

export function DetailSheet({
  open,
  onOpenChange,
  size = "2xl",
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  className?: string;
  children: React.ReactNode;
}) {
  const content = useRef(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        size={size}
        className={cn("flex flex-col gap-0 p-0", className)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          content.current?.focus();
        }}
      >
        {children}
      </SheetContent>
    </Sheet>
  );
}

export function DetailSheetHeader({
  media,
  title,
  description,
  note,
  actions,
  onBack,
  onClose,
}: {
  media?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  note?: React.ReactNode;
  actions?: React.ReactNode;
  onBack?: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-2 px-5 pt-4 pb-2">
        {onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onBack}
            className="h-8 w-8"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <div className="flex-1 flex items-center gap-3">
          {media && <div className="flex-shrink-0">{media}</div>}
          <div className="min-w-0 flex-1">
            <SheetTitle className="truncate text-left">{title}</SheetTitle>
            {description ? (
              <SheetDescription className="text-left text-xs">
                {description}
              </SheetDescription>
            ) : null}
            {note ? (
              <p className="text-[11px] text-muted-foreground text-left">
                {note}
              </p>
            ) : null}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
          {actions && <Separator orientation="vertical" className="h-6" />}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
            aria-label="Close"
          >
            <Close className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Separator />
    </>
  );
}

export function DetailSheetStats({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b">
      {children}
    </div>
  );
}

export function DetailSheetStat({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium">{children}</span>
    </div>
  );
}

export type DetailSheetTab = {
  value: string;
  label: string;
  count?: number | null;
  content: React.ReactNode;
  keepMounted?: boolean;
};

export function DetailSheetTabs({
  tabs,
  value,
  onValueChange,
}: {
  tabs: DetailSheetTab[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const [opened] = React.useState(() => new Set<string>());
  opened.add(value);

  return (
    <div className="flex flex-col">
      <div className="flex border-b px-5">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => onValueChange(tab.value)}
            className={cn(
              "px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              value === tab.value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.count ? (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {tab.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {tabs.map((tab) => (
        <div key={tab.value} className={cn("px-5 py-4", value !== tab.value && "hidden")}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}

export function DetailSheetBody({ children }: { children: React.ReactNode }) {
  return <div className={cn("px-5 py-4", GUTTER)}>{children}</div>;
}

export function DetailSheetSection({
  title,
  action,
  className,
  children,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("py-4", className)}>
      {title || action ? (
        <div className="mb-3 flex items-center justify-between">
          {title ? <h3 className={SECTION_TITLE}>{title}</h3> : null}
          {action}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function DetailSheetSplit({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[1fr_1fr] gap-4 px-5 py-4">{children}</div>;
}

export function DetailSheetMain({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 px-5 py-4">{children}</div>;
}

export function DetailSheetRail({ children }: { children: React.ReactNode }) {
  return <div className="w-64 border-l px-5 py-4">{children}</div>;
}

export function DetailSheetProperties({
  children,
  columns = 2,
}: {
  children: React.ReactNode;
  columns?: 1 | 2;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-2",
        columns === 2 ? "grid-cols-2" : "grid-cols-1"
      )}
    >
      {children}
    </div>
  );
}

export function DetailSheetPending({
  fields,
  running,
}: {
  fields: string[];
  running: boolean;
}) {
  if (fields.length === 0) return null;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <span
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          running ? "bg-blue-500 animate-pulse" : "bg-muted"
        )}
      />
      <span>{running ? "Agent is researching" : "Not known yet"}</span>
      <span className="text-xs">({fields.join(", ")})</span>
    </div>
  );
}

export function DetailSheetProperty({
  label,
  wide = false,
  children,
}: {
  label: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(PROPERTY_ROW, wide && "col-span-2")}>
      <span className={PROPERTY_LABEL}>{label}</span>
      <span className={PROPERTY_CELL}>{children}</span>
    </div>
  );
}

export function DetailSheetProse({ children }: { children: React.ReactNode }) {
  return <div className="text-sm leading-relaxed">{children}</div>;
}

export function DetailSheetEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}