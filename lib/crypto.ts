import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Crypto utilities for webhook signature verification
 * Server-only: uses node:crypto
 */
export const crypto = {
  createHmac,
  timingSafeEqual,
}