import type { RateLimiter } from "./rate-limiter";

/**
 * Worker bindings. Plain-text settings live in `wrangler.jsonc` `vars`;
 * everything marked "secret" is set with `wrangler secret put` (or `.dev.vars`
 * locally) and must never be committed.
 */
export interface Env {
  /** `sub:<email>` = "active" while a Premium subscription is paid. */
  SUBSCRIPTIONS: KVNamespace;
  /** Recordings (`recordings/`) and the per-owner index (`owners/`). */
  RECORDINGS: R2Bucket;
  /** Strongly consistent counters: email rate limits and one-time tokens. */
  RATE_LIMITER: DurableObjectNamespace<RateLimiter>;

  /** Website origin, e.g. https://capann.example. Hosts /verify and /view-my-links. */
  SITE_URL: string;
  /** Extra CORS origins, comma-separated, e.g. chrome-extension://<id>. */
  ALLOWED_ORIGINS: string;
  /** Sender address, e.g. "Capann <login@capann.example>". */
  EMAIL_FROM: string;
  /** "resend" in production; "console" logs links instead of sending (local dev only). */
  EMAIL_TRANSPORT: string;
  /** Bachs hosted checkout URL with an `{email}` placeholder. */
  BACHS_CHECKOUT_URL: string;
  /** Largest single-request upload. Workers cap request bodies at 100 MB on Free/Pro. */
  MAX_UPLOAD_BYTES: string;
  /** Largest recording accepted through multipart upload. */
  MAX_RECORDING_BYTES: string;

  /** secret: HMAC key for every token this Worker issues. 32+ random bytes. */
  JWT_SECRET: string;
  /** secret: Resend API key. */
  RESEND_API_KEY: string;
  /** secret: shared secret Bachs signs webhooks with. */
  BACHS_WEBHOOK_SECRET: string;
}
