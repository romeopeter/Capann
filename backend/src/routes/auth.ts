import type { Env } from "../env";
import { normalizeEmail, sendMagicLink } from "../email";
import type { MagicLinkKind } from "../email";
import { HttpError, json, readJson } from "../http";
import { claimOnce, hit } from "../rate-limiter";
import { isPaid } from "../subscriptions";
import { issueToken, nowSeconds, requireBearer, verifyToken } from "../tokens";

const WINDOW_MS = 15 * 60 * 1000;
/** Spec: at most 3 emails per address per 15 minutes. */
const EMAIL_LIMIT = 3;
/**
 * Per-IP cap on top of the per-email one. Without it, one client could send
 * 3 emails to every address it can think of, which is the expensive abuse.
 */
const IP_LIMIT = 10;

const LANDING_PATH: Record<MagicLinkKind, string> = {
  login: "/verify",
  links: "/view-my-links",
};

function tooMany(retryAfterSeconds: number): HttpError {
  return new HttpError(
    429,
    "RATE_LIMITED",
    "Too many emails requested. Try again in a few minutes.",
    { "retry-after": String(retryAfterSeconds) },
  );
}

/**
 * POST /api/auth/magic-link  { email, purpose?: "login" | "links" }
 * Emails a 15-minute link: /verify for sign-in, /view-my-links for recovery.
 */
export async function magicLink(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, "INVALID_EMAIL", "Enter a valid email address.");

  const purpose = body.purpose ?? "login";
  if (purpose !== "login" && purpose !== "links")
    throw new HttpError(400, "INVALID_PURPOSE", 'purpose must be "login" or "links".');

  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const byIp = await hit(env, `magic:ip:${ip}`, IP_LIMIT, WINDOW_MS);
  if (!byIp.allowed) throw tooMany(byIp.retryAfterSeconds);
  const byEmail = await hit(env, `magic:email:${email}`, EMAIL_LIMIT, WINDOW_MS);
  if (!byEmail.allowed) throw tooMany(byEmail.retryAfterSeconds);

  const { token } = await issueToken(env, purpose, email, {});
  const link = new URL(LANDING_PATH[purpose], env.SITE_URL);
  link.searchParams.set("token", token);
  await sendMagicLink(env, email, purpose, link.toString());

  // Same response whatever the address, so this can't be used to probe emails.
  return json({ sent: true }, 202);
}

async function sessionResponse(env: Env, email: string, expiresAt?: number): Promise<Response> {
  const paid = await isPaid(env, email);
  const { token, claims } = await issueToken(env, "session", email, { paid }, expiresAt);
  return json({
    token,
    email,
    paid,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  });
}

/**
 * POST /api/auth/verify  { token }
 * Exchanges a login link token (once) for a 30-day session token.
 */
export async function verify(request: Request, env: Env): Promise<Response> {
  const body = await readJson(request);
  const claims = await verifyToken(env, typeof body.token === "string" ? body.token : null, [
    "login",
  ] as const);

  // Single use. The Durable Object is strongly consistent, so two tabs racing
  // the same link get one session between them.
  const first = await claimOnce(env, `jti:${claims.jti}`, (claims.exp - nowSeconds()) * 1000);
  if (!first)
    throw new HttpError(401, "TOKEN_USED", "This sign-in link was already used. Request a new one.");

  return sessionResponse(env, claims.sub);
}

/**
 * GET /api/auth/session  (Bearer session)
 * Re-reads the subscription and returns a session token with a current `paid`
 * flag — call it after checkout. The expiry is kept, so a session can't be
 * extended indefinitely by refreshing it.
 */
export async function refreshSession(request: Request, env: Env): Promise<Response> {
  const claims = await requireBearer(request, env, ["session"] as const);
  return sessionResponse(env, claims.sub, claims.exp);
}
