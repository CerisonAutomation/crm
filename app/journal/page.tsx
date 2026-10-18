import { aliasToView } from "@/lib/view-alias";

/**
 * `/journal` — canonical URL for the Journal index (Lane Pages explorer).
 * Article permalinks use `?view=article&slug=…`, forwarded through this hop.
 */
export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return aliasToView("journal", searchParams);
}
