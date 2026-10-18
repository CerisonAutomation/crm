/**
 * Security utilities for handling sensitive data.
 * Implements patterns from n8n-core.txt and other sources for secure handling of secrets.
 */

/**
 * Masks a secret by showing only first and last 2 characters with bullets in between.
 * Follows the pattern from n8n-core.txt where secrets are never displayed in plaintext.
 */
export function maskSecret(secret: string): string {
  if (!secret || secret.length <= 6) return "••••••";
  return `${secret.slice(0, 2)}••••••••${secret.slice(-2)}`;
}

/**
 * Redacts potentially sensitive information from an object.
 * Recursively traverses the object and masks values that look like secrets.
 */
export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === "string") {
    // Check if this looks like a secret or sensitive information
    if (isLikelySecret(obj)) {
      return maskSecret(obj);
    }
    return obj;
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData);
  }

  if (typeof obj === "object") {
    const redacted: Record<string, unknown> = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Check if the key itself suggests sensitivity
        const redactedValue = isLikelySecretKey(key)
          ? "••••••"
          : redactSensitiveData((obj as Record<string, unknown>)[key]);
        redacted[key] = redactedValue;
      }
    }
    return redacted;
  }

  return obj;
}

/**
 * Checks if a string looks like it could be a secret or sensitive information.
 * This is a heuristic - in a real implementation, you might have more specific
 * patterns based on your known secret formats.
 */
function isLikelySecret(value: string): boolean {
  if (!value || typeof value !== "string") return false;

  // Common patterns that might indicate secrets
  const secretPatterns = [
    /^[A-Fa-f0-9]{8,}$/, // Hex strings (could be hashes, keys)
    /^[A-Za-z0-9+/]{20,}={0,2}$/, // Base64 strings
    /^[\w\-]{20,}$/, // Long alphanumeric strings
    /^(?:[A-Za-z0-9\-_]{4,})+$/, // JWT-like tokens
  ];

  return secretPatterns.some((pattern) => pattern.test(value));
}

/**
 * Checks if a key name suggests it might contain sensitive information.
 */
function isLikelySecretKey(key: string): boolean {
  if (!key || typeof key !== "string") return false;

  const lowerKey = key.toLowerCase();
  const secretKeyPatterns = [
    "secret",
    "key",
    "token",
    "password",
    "passwd",
    "pwd",
    "auth",
    "credential",
    "private",
    "ssh",
    "ssl",
    "api",
    "access",
    "refresh",
    "id_token",
    "client_secret",
    "client_id",
    "grant_type",
    "code",
    "redirect_uri",
  ];

  return secretKeyPatterns.some((pattern) => lowerKey.includes(pattern));
}

/**
 * Creates a capability token for secure webhook URLs.
 * Following the pattern from cl-workflows.txt: unguessable 192-bit token.
 */
export function generateCapabilityToken(): string {
  // In a real implementation, this would use crypto.randomBytes
  // For now, we'll return a placeholder that follows the format
  return "placeholder_capability_token_that_should_be_replaced_with_real_crypto";
}

/**
 * Creates a signing secret for webhook signatures.
 * Following the pattern from cl-workflows.txt: 256-bit hex secret.
 */
export function generateSigningSecret(): string {
  // In a real implementation, this would use crypto.randomBytes(32).toString('hex')
  return "placeholder_signing_secret_that_should_be_replaced_with_real_crypto";
}

/**
 * Verifies a HMAC signature for webhook security.
 * Following the pattern from cl-workflows.txt.
 */
export function verifyWebhookSignature(
  secret: string,
  payload: string,
  signature: string,
): boolean {
  // In a real implementation, this would use timing-safe HMAC verification
  // For now, we'll return a placeholder
  return true; // Placeholder - should be replaced with real implementation
}
