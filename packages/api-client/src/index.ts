/**
 * @capann/api-client
 *
 * A small fetch-based client for the API's JSON routes. Shapes come from
 * @capann/contract, so a route change that breaks a caller fails typecheck.
 *
 * Runs anywhere with fetch: the extension's service worker and side panel
 * (extension pages are CORS-exempt for hosts in `host_permissions`; content
 * scripts are not, so the page never calls this), the website's Premium pages,
 * and Node in tests. Requests send no cookies, use no cache, and send no
 * referrer: auth is always the bearer token, and a token in a page URL must
 * not leak. Recording uploads are not here: they need upload progress, which only
 * XMLHttpRequest reports, so they live in the extension's offscreen uploader.
 */

import { API_ROUTES } from "@capann/contract";
import type {
  ApiErrorBody,
  ApiErrorCode,
  CheckoutResponse,
  LinkListResponse,
  MagicLinkPurpose,
  MagicLinkRequest,
  MagicLinkResponse,
  SessionResponse,
  VerifyRequest,
} from "@capann/contract";

/** Errors that never reached the API, or came back unreadable. */
export type ClientErrorCode = "NETWORK" | "SERVER";

/**
 * A failed call. `code` is the API's error code, "NETWORK" when no response
 * arrived, or "SERVER" when the response wasn't a readable error. `message`
 * is the API's user-safe text when there is one.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | ClientErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const SERVER_TROUBLE = "Capann's server had a problem. Try again in a moment.";

/**
 * The ApiError for a non-success response. Shared by `apiFetch` and by
 * clients with their own transport (the extension's uploader), so every
 * caller reads error bodies the same way.
 */
export function apiErrorFrom(
  status: number,
  bodyText: string,
  retryAfter?: number,
  fallbackMessage = SERVER_TROUBLE,
): ApiError {
  let error: Partial<ApiErrorBody["error"]> | undefined;
  try {
    error = (JSON.parse(bodyText) as Partial<ApiErrorBody> | null)?.error;
  } catch {
    // Not JSON (a proxy's error page, for instance): a server error.
  }
  return new ApiError(
    status,
    error?.code ?? "SERVER",
    error?.message ?? fallbackMessage,
    retryAfter,
  );
}

const REQUEST_TIMEOUT_MS = 15_000;

/** Per-call options every helper accepts. */
export interface RequestOptions {
  /**
   * Cancels the request (a page unmounting, say). A cancelled call rejects
   * with the signal's own AbortError, not an ApiError, so callers can ignore it.
   */
  signal?: AbortSignal;
}

/**
 * Aborts when either signal does. `AbortSignal.any` is recent (Safari 17.4),
 * and `/view-my-links` opens from an email in any browser, so fall back to
 * linking them by hand.
 */
function eitherSignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const controller = new AbortController();
  for (const signal of [a, b]) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

export async function apiFetch<T>(
  apiUrl: string,
  path: string,
  init: { method?: string; token?: string; json?: unknown } & RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      signal: init.signal ? eitherSignal(init.signal, timeout) : timeout,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch (error) {
    // The caller cancelled: not a failure of Capann's.
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, "NETWORK", "Couldn't reach Capann. Check your connection and try again.");
  }
  const text = await response.text();
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after")) || undefined;
    throw apiErrorFrom(response.status, text, retryAfter);
  }
  try {
    return (text ? JSON.parse(text) : null) as T;
  } catch {
    throw new ApiError(response.status, "SERVER", SERVER_TROUBLE);
  }
}

/** Emails a sign-in link (`/verify`) or a link-recovery link (`/view-my-links`). */
export function requestMagicLink(
  apiUrl: string,
  email: string,
  purpose: MagicLinkPurpose,
  options: RequestOptions = {},
): Promise<MagicLinkResponse> {
  return apiFetch(apiUrl, API_ROUTES.magicLink, {
    ...options,
    method: "POST",
    json: { email, purpose } satisfies MagicLinkRequest,
  });
}

/** Exchanges a login link's token (once) for a 30-day session. The website's `/verify` uses it. */
export function exchangeLoginToken(
  apiUrl: string,
  token: string,
  options: RequestOptions = {},
): Promise<SessionResponse> {
  return apiFetch(apiUrl, API_ROUTES.verify, {
    ...options,
    method: "POST",
    json: { token } satisfies VerifyRequest,
  });
}

/** Re-reads `paid` from the subscription record. Keeps the original expiry. */
export function getSession(
  apiUrl: string,
  token: string,
  options: RequestOptions = {},
): Promise<SessionResponse> {
  return apiFetch(apiUrl, API_ROUTES.session, { ...options, token });
}

/** Bachs checkout URL for the signed-in email. */
export function startCheckout(
  apiUrl: string,
  token: string,
  options: RequestOptions = {},
): Promise<CheckoutResponse> {
  return apiFetch(apiUrl, API_ROUTES.checkout, { ...options, method: "POST", token });
}

/**
 * The live links for a session or a links token (the website's
 * `/view-my-links`), newest first.
 */
export function listLinks(
  apiUrl: string,
  token: string,
  options: RequestOptions = {},
): Promise<LinkListResponse> {
  return apiFetch(apiUrl, API_ROUTES.links, { ...options, token });
}
