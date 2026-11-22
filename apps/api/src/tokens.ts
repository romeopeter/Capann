import type { Env } from "./env";
import { bearerToken, HttpError } from "./http";
import { signJwt, verifyJwt } from "./jwt";

/**
 * Every token carries a purpose (`pur`) and is only accepted where that
 * purpose is expected, so a 15-minute login link can never be used as a
 * session, and an upload token can never list links.
 */
export type Purpose = "login" | "links" | "session" | "upload";

const TTL_SECONDS: Record<Purpose, number> = {
  login: 15 * 60,
  links: 15 * 60,
  // Matches the monthly billing cycle. The paid flag inside is a display hint;
  // uploads re-check the subscription in KV (see requirePaid).
  session: 30 * 24 * 60 * 60,
  upload: 6 * 60 * 60,
};

const ISSUER = "capann";

interface BaseClaims {
  iss: typeof ISSUER;
  sub: string;
  pur: Purpose;
  iat: number;
  exp: number;
  jti: string;
}

export interface LoginClaims extends BaseClaims {
  pur: "login";
}
export interface LinksClaims extends BaseClaims {
  pur: "links";
}
export interface SessionClaims extends BaseClaims {
  pur: "session";
  paid: boolean;
}
export interface UploadClaims extends BaseClaims {
  pur: "upload";
  /** R2 object key the multipart upload writes to. */
  key: string;
  /** R2 multipart upload id. */
  uid: string;
  /** Part size every part except the last must use. */
  ps: number;
}

export type Claims = LoginClaims | LinksClaims | SessionClaims | UploadClaims;
type ClaimsFor<P extends Purpose> = Extract<Claims, { pur: P }>;
type Extra<P extends Purpose> = Omit<ClaimsFor<P>, keyof BaseClaims>;

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function issueToken<P extends Purpose>(
  env: Env,
  purpose: P,
  email: string,
  extra: Extra<P>,
  /** Keep an existing expiry (session refresh) instead of starting a new one. */
  expiresAt?: number,
): Promise<{ token: string; claims: ClaimsFor<P> }> {
  const iat = nowSeconds();
  const claims = {
    ...extra,
    iss: ISSUER,
    sub: email,
    pur: purpose,
    iat,
    exp: expiresAt ?? iat + TTL_SECONDS[purpose],
    jti: crypto.randomUUID(),
  } as ClaimsFor<P>;
  return { token: await signJwt(claims, env.JWT_SECRET), claims };
}

function isClaims(payload: Record<string, unknown>): payload is Record<string, unknown> & BaseClaims {
  return (
    payload.iss === ISSUER &&
    typeof payload.sub === "string" &&
    typeof payload.pur === "string" &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number" &&
    typeof payload.jti === "string"
  );
}

export async function verifyToken<P extends Purpose>(
  env: Env,
  token: string | null,
  purposes: readonly P[],
): Promise<ClaimsFor<P>> {
  if (!token) throw new HttpError(401, "MISSING_TOKEN", "Sign in to continue.");
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload || !isClaims(payload))
    throw new HttpError(401, "INVALID_TOKEN", "This link or session is not valid.");
  if (!(purposes as readonly string[]).includes(payload.pur))
    throw new HttpError(401, "WRONG_TOKEN", "This token can't be used here.");
  if (payload.exp <= nowSeconds())
    throw new HttpError(401, "TOKEN_EXPIRED", "This link or session has expired.");
  return payload as unknown as ClaimsFor<P>;
}

export function requireBearer<P extends Purpose>(
  request: Request,
  env: Env,
  purposes: readonly P[],
): Promise<ClaimsFor<P>> {
  return verifyToken(env, bearerToken(request), purposes);
}
