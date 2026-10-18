import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { clampPasswordMinLength, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { loadPlatformSettings } from "@/lib/settings/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/policy — the account policies a person must satisfy.
 *
 * Deliberately public. The password minimum is a rule the visitor has to meet on
 * the sign-up and password-reset screens, which run before any session exists, so
 * it cannot be session-gated without the client guessing a number the server
 * enforces differently. Nothing here is a secret: it is the published policy, not
 * the credential. The value is the same one `/api/settings` stores and the
 * account service enforces, read through the identical clamp.
 */
export async function GET(_req: NextRequest) {
  return handler(async () => {
    let min = PASSWORD_MIN_LENGTH;
    try {
      const settings = await loadPlatformSettings();
      min = clampPasswordMinLength(settings.operations.passwordMinLength ?? PASSWORD_MIN_LENGTH);
    } catch {
      // Settings unreachable — answer with the canon default rather than an
      // error, so the credential screens always render a coherent number.
      min = PASSWORD_MIN_LENGTH;
    }
    return jsonOk({ passwordMinLength: min });
  })(_req);
}
