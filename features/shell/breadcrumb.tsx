"use client";
/**
 * ViewBreadcrumb — orientation for the authenticated shell: `Section › View`,
 * rendered at the top of `<main>` on every breakpoint. Detail views show
 * `Section › Parent list › Current`, where the parent returns to the list
 * (active-clear: rm-case → rm-queue, studio-detail → studio-workflows,
 * pages-editor → pages-list).
 *
 * Built from the shared nav config (`NAV` + `isItemActive`), so the section
 * and labels always match the sidebar. It never renders a heading — the views
 * own their h1s (the client dashboard's case reference stays the only h1).
 */
import { useApp, type View } from "@/lib/store";
import { useI18n, type StringKey } from "@/lib/i18n";
import { NAV, sectionHeading, isItemActive } from "@/lib/nav";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/** Detail views: the list label + i18n key of the current record's node. */
const DETAIL_CRUMBS: Partial<Record<View, StringKey>> = {
  "rm-case": "crumb.case",
  "studio-detail": "crumb.workflow",
  "pages-editor": "crumb.page",
};

export function ViewBreadcrumb() {
  const session = useApp((s) => s.session);
  const view = useApp((s) => s.view);
  const adminPanel = useApp((s) => s.adminPanel);
  const setActiveCase = useApp((s) => s.setActiveCase);
  const setActiveWorkflow = useApp((s) => s.setActiveWorkflow);
  const setActivePage = useApp((s) => s.setActivePage);
  const { t } = useI18n();

  if (!session) return null;

  // The role's nav items; isItemActive highlights the list parent for detail
  // views and picks the right admin-automation panel item.
  const items = NAV.filter((n) => n.roles.includes(session.role));
  const active = items.find((n) => isItemActive(n, view, adminPanel));
  if (!active) return null;

  const detailKey = DETAIL_CRUMBS[view];
  const isDetail = detailKey !== undefined && active.view !== view;
  const currentKey = detailKey ?? active.labelKey;
  const back =
    view === "rm-case"
      ? () => setActiveCase(null)
      : view === "studio-detail"
        ? () => setActiveWorkflow(null)
        : view === "pages-editor"
          ? () => setActivePage(null)
          : null;

  return (
    <div className="px-5 md:px-8 pt-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <span className="text-muted-foreground">{sectionHeading(active.section, session.name, t)}</span>
          </BreadcrumbItem>
          {isDetail && back && (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <button
                    type="button"
                    onClick={back}
                    className="inline-flex min-h-10 items-center rounded-sm text-sm hover:underline"
                  >
                    {t(active.labelKey)}
                  </button>
                </BreadcrumbLink>
              </BreadcrumbItem>
            </>
          )}
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{t(currentKey)}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
