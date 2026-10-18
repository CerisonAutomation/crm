/**
 * view-alias — canonical URL entry points for the SPA's view store.
 *
 * The product is a single-route SPA (`/?view=…`), but real URLs matter: emails,
 * bookmarks, search results and PWA shortcuts all want stable paths such as
 * `/login` or `/journal`. Each alias route calls `aliasToView`, which hands the
 * browser over to the SPA root with the requested view — carrying every query
 * param through, so `?token=…` and `?slug=…` survive the hop.
 *
 * Server-only: `redirect` comes from next/navigation and must never be reached
 * from a client component.
 */
import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Forward to `/?view=<view>`, preserving the original query string. */
export async function aliasToView(view: string, searchParams: SearchParams): Promise<never> {
  const params = await searchParams;
  const qs = new URLSearchParams({ view });
  for (const [key, value] of Object.entries(params)) {
    if (key !== "view" && typeof value === "string") qs.set(key, value);
  }
  return redirect(`/?${qs.toString()}`);
}
