import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export interface HitResult {
  allowed: boolean;
  /** Seconds until the next hit would be allowed; 0 when allowed. */
  retryAfterSeconds: number;
}

/**
 * Sliding-window counter, one Durable Object instance per key.
 *
 * Durable Objects run one request at a time per instance with strongly
 * consistent storage, so two simultaneous requests for the same email can't
 * both slip under the limit. KV can't promise that: it's eventually consistent
 * and has no atomic increment, which makes it unsuitable for a strict limit.
 */
export class RateLimiter extends DurableObject<Env> {
  async hit(limit: number, windowMs: number): Promise<HitResult> {
    const now = Date.now();
    const stored = (await this.ctx.storage.get<number[]>("hits")) ?? [];
    const hits = stored.filter((time) => now - time < windowMs);

    if (hits.length >= limit) {
      const oldest = hits[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      };
    }

    hits.push(now);
    await this.ctx.storage.put("hits", hits);
    // Every hit is stale once the window after the newest one has passed.
    await this.ctx.storage.setAlarm(now + windowMs);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export function hit(
  env: Env,
  key: string,
  limit: number,
  windowMs: number,
): Promise<HitResult> {
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key));
  return stub.hit(limit, windowMs);
}

/**
 * True the first time `key` is claimed within `ttlMs`, false afterwards.
 * Used to make magic-link tokens single-use.
 */
export async function claimOnce(env: Env, key: string, ttlMs: number): Promise<boolean> {
  const result = await hit(env, key, 1, Math.max(ttlMs, 1000));
  return result.allowed;
}
