/**
 * Client for the Premium backend's JSON routes (`backend/README.md`).
 *
 * Runs in the service worker and the side panel: extension pages are exempt
 * from CORS for hosts in `host_permissions`, content scripts are not, so the
 * page never calls this directly. Uploads live in `offscreen/uploader.ts`
 * because the recording blob lives in the offscreen document.
 *
 * Every shape here is a contract with `backend/src/routes/*`. Change both in the
 * same commit.
 */

import type { ShareLink } from "../types";

export interface SessionResponse {
  token: string;
  email: string;
  paid: boolean;
  expiresAt: string;
}

export interface LinkListItem extends ShareLink {
  remainingSeconds: number;
}

export interface LinkListResponse {
  email: string;
  now: string;
  retentionSeconds: number;
  items: LinkListItem[];
}

/**
 * A failed call. `code` is the backend's error code, or "NETWORK" when no
 * response arrived. `message` is the backend's user-safe text when there is one.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

export async function apiFetch<T>(
  apiUrl: string,
  path: string,
  init: { method?: string; token?: string; json?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Couldn't reach Capann. Check your connection and try again.");
  }
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON (a proxy error page, for instance) is handled as a server error.
  }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    const retryAfter = Number(response.headers.get("retry-after")) || undefined;
    throw new ApiError(
      response.status,
      error?.code ?? "SERVER",
      error?.message ?? "Capann's server had a problem. Try again in a moment.",
      retryAfter,
    );
  }
  return body as T;
}

/** Emails a sign-in link (`/verify`) or a link-recovery link (`/view-my-links`). */
export function requestMagicLink(
  apiUrl: string,
  email: string,
  purpose: "login" | "links",
): Promise<{ sent: true }> {
  return apiFetch(apiUrl, "/api/auth/magic-link", {
    method: "POST",
    json: { email, purpose },
  });
}

/** Re-reads `paid` from the subscription record. Keeps the original expiry. */
export function getSession(apiUrl: string, token: string): Promise<SessionResponse> {
  return apiFetch(apiUrl, "/api/auth/session", { token });
}

/** Bachs checkout URL for the signed-in email. */
export function startCheckout(apiUrl: string, token: string): Promise<{ url: string }> {
  return apiFetch(apiUrl, "/api/checkout", { method: "POST", token });
}

/** The signed-in user's live links, newest first. */
export function listLinks(apiUrl: string, token: string): Promise<LinkListResponse> {
  return apiFetch(apiUrl, "/api/links/list", { token });
}
