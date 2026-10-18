"use client";

import {
  Sheet as UISheet,
  SheetContent as UISheetContent,
  SheetDescription as UISheetDescription,
  SheetHeader as UISheetHeader,
  SheetTitle as UISheetTitle,
} from "@/components/brand/sheet";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/components/brand/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type * as React from "react";
import { createContext, useContext } from "react";

const ResponsiveContext = createContext(false);
const useResponsive = () => useContext(ResponsiveContext);

type RootProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  modal?: boolean;
  children?: React.ReactNode;
};

function Sheet({ children, ...props }: RootProps) {
  const isMobile = useIsMobile();
  return (
    <ResponsiveContext.Provider value={isMobile}>
      {isMobile ? (
        <Drawer {...props}>{children}</Drawer>
      ) : (
        <UISheet {...props}>{children}</UISheet>
      )}
    </ResponsiveContext.Provider>
  );
}

function SheetContent({
  children,
  side,
  size,
  showCloseButton,
  className,
  ...props
}: React.ComponentProps<typeof UISheetContent> & {
  side?: "top" | "right" | "bottom" | "left";
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";
  showCloseButton?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
}) {
  if (useResponsive()) {
    return (
      <DrawerContent className={cn("bg-background", className)} {...props}>
        {children}
      </DrawerContent>
    );
  }
  return (
    <UISheetContent
      className={cn("bg-background", className)}
      {...props}
    >
      {children}
    </UISheetContent>
  );
}

function SheetHeader(props: React.ComponentProps<typeof UISheetHeader>) {
  return useResponsive() ? (
    <DrawerHeader className="text-left" {...props} />
  ) : (
    <UISheetHeader {...props} />
  );
}

function SheetTitle(props: {
  className?: string;
  size?: "default" | "lg";
  children?: React.ReactNode;
}) {
  return useResponsive() ? (
    <DrawerTitle className="text-left" {...props} />
  ) : (
    <UISheetTitle {...props} />
  );
}

function SheetDescription(props: {
  className?: string;
  children?: React.ReactNode;
}) {
  return useResponsive() ? (
    <DrawerDescription className="text-left" {...props} />
  ) : (
    <UISheetDescription {...props} />
  );
}

export { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle };