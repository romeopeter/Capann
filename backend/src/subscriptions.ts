import type { Env } from "./env";
import { HttpError } from "./http";
import { nowSeconds } from "./tokens";

/**
 * Subscription state is one KV key per email: `sub:<email>` = "active".
 * A missing key means not paid. Only the Bachs webhook writes it.
 *
 * KV is eventually consistent: a write can take up to ~60 seconds to be seen
 * in every location, so a brand-new subscriber may briefly read as unpaid.
 */
const ACTIVE = "active";
const key = (email: string) => `sub:${email}`;

/** Keep paid access this long past the billing period if a renewal webhook is late. */
const GRACE_SECONDS = 3 * 24 * 60 * 60;

export async function isPaid(env: Env, email: string): Promise<boolean> {
  return (await env.SUBSCRIPTIONS.get(key(email))) === ACTIVE;
}

/**
 * Mark active. With a known period end the key expires on its own after a
 * grace period, so a missed cancellation webhook can't grant access forever.
 */
export async function setActive(env: Env, email: string, periodEnd?: number): Promise<void> {
  const options: KVNamespacePutOptions = {};
  if (periodEnd !== undefined) {
    // KV requires expirations at least 60 seconds in the future.
    options.expiration = Math.max(periodEnd + GRACE_SECONDS, nowSeconds() + 60);
  }
  await env.SUBSCRIPTIONS.put(key(email), ACTIVE, options);
}

/**
 * Mark inactive. A cancellation that still has paid time left keeps access
 * until the period ends; otherwise access stops now.
 */
export async function setInactive(env: Env, email: string, periodEnd?: number): Promise<void> {
  if (periodEnd !== undefined && periodEnd > nowSeconds() + 60) {
    await env.SUBSCRIPTIONS.put(key(email), ACTIVE, { expiration: periodEnd });
    return;
  }
  await env.SUBSCRIPTIONS.delete(key(email));
}

export async function requirePaid(env: Env, email: string): Promise<void> {
  if (!(await isPaid(env, email)))
    throw new HttpError(
      402,
      "PAYMENT_REQUIRED",
      "Cloud links are a Premium feature. Upgrade to upload recordings.",
    );
}
