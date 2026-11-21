/**
 * bachs.ts — the only file that knows Bachs' webhook format.
 *
 * ASSUMPTIONS TO CONFIRM AGAINST BACHS' DOCUMENTATION BEFORE LAUNCH.
 * None of these were verified; adjust this file and nothing else:
 *
 * 1. Signature: the `x-bachs-signature` header carries the lowercase hex
 *    HMAC-SHA256 of the raw request body, keyed with BACHS_WEBHOOK_SECRET.
 *    (Some processors sign `timestamp.body` or use base64 — change
 *    `signedPayload` / `decodeSignature` if so.)
 * 2. Payload: JSON `{ "type": string, "data": { "customer": { "email": string },
 *    "current_period_end"?: number | string } }`, where the period end is unix
 *    seconds, unix milliseconds, or an ISO date.
 * 3. Event names: listed in ACTIVATING / DEACTIVATING below. Anything else is
 *    acknowledged and ignored.
 */

import { normalizeEmail } from "./email";

const SIGNATURE_HEADER = "x-bachs-signature";

const ACTIVATING = new Set([
  "subscription.created",
  "subscription.activated",
  "subscription.renewed",
  "subscription.resumed",
]);

const DEACTIVATING = new Set([
  "subscription.cancelled",
  "subscription.canceled",
  "subscription.expired",
  "subscription.paused",
]);

export interface SubscriptionEvent {
  email: string;
  status: "active" | "inactive";
  /** End of the paid period, unix seconds, when Bachs provides it. */
  periodEnd?: number;
}

const encoder = new TextEncoder();

function decodeSignature(header: string): Uint8Array | null {
  const hex = header.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function signedPayload(rawBody: string): string {
  return rawBody;
}

export async function verifyBachsSignature(
  request: Request,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  if (!secret) return false;
  const signature = decodeSignature(request.headers.get(SIGNATURE_HEADER) ?? "");
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  // Constant-time comparison.
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(signedPayload(rawBody)));
}

function toUnixSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value))
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

/** Null for events that don't change subscription state. */
export function parseBachsEvent(body: unknown): SubscriptionEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const { type, data } = body as { type?: unknown; data?: unknown };
  if (typeof type !== "string" || typeof data !== "object" || data === null) return null;

  const status = ACTIVATING.has(type) ? "active" : DEACTIVATING.has(type) ? "inactive" : null;
  if (!status) return null;

  const record = data as { customer?: { email?: unknown }; current_period_end?: unknown };
  const email = normalizeEmail(record.customer?.email);
  if (!email) return null;

  const periodEnd = toUnixSeconds(record.current_period_end);
  return periodEnd === undefined ? { email, status } : { email, status, periodEnd };
}
