/**
 * Premium state kept in `chrome.storage.local` (survives restarts, unlike the
 * per-tab annotations in `storage.session`):
 *
 * - `capann_session`  the 30-day session token and its claims
 * - `capann_prefs`    the "save a local copy?" choice
 * - `capann_links`    links made on this device: the zero-auth history the side
 *                     panel falls back to when the server can't be reached
 *
 * Only the worker and the side panel import this. The page gets an
 * `AccountSummary` (no token) over messages; the offscreen document has no
 * `chrome.storage` and receives the token with the stop command.
 */

import type { AccountSummary, CopyPreference, ShareLink } from "../types";
import type { SessionResponse } from "@capann/contract";

export const SESSION_KEY = "capann_session";
export const PREFS_KEY = "capann_prefs";
export const LINKS_KEY = "capann_links";

export interface StoredSession extends SessionResponse {
  /** When `paid` was last confirmed with the server (ms). */
  checkedAt: number;
}

interface Prefs {
  copyPreference: CopyPreference;
}

/** History cap; links expire after 7 days, so this is rarely reached. */
const MAX_LINKS = 200;

function isExpired(iso: string, now = Date.now()): boolean {
  const time = Date.parse(iso);
  return !Number.isFinite(time) || time <= now;
}

/** The stored session, or null when there is none or it has expired. */
export async function loadSession(): Promise<StoredSession | null> {
  const { [SESSION_KEY]: session } = await chrome.storage.local.get(SESSION_KEY);
  if (!session || typeof session !== "object") return null;
  const value = session as StoredSession;
  if (typeof value.token !== "string" || isExpired(value.expiresAt)) {
    await chrome.storage.local.remove(SESSION_KEY);
    return null;
  }
  return value;
}

export async function saveSession(session: SessionResponse): Promise<StoredSession> {
  const stored: StoredSession = {
    token: session.token,
    email: session.email,
    paid: session.paid,
    expiresAt: session.expiresAt,
    checkedAt: Date.now(),
  };
  await chrome.storage.local.set({ [SESSION_KEY]: stored });
  return stored;
}

export function clearSession(): Promise<void> {
  return chrome.storage.local.remove(SESSION_KEY);
}

export async function loadPrefs(): Promise<Prefs> {
  const { [PREFS_KEY]: prefs } = await chrome.storage.local.get(PREFS_KEY);
  const choice = (prefs as Partial<Prefs> | undefined)?.copyPreference;
  return {
    copyPreference: choice === "always" || choice === "never" ? choice : "ask",
  };
}

export function saveCopyPreference(copyPreference: CopyPreference): Promise<void> {
  return chrome.storage.local.set({ [PREFS_KEY]: { copyPreference } satisfies Prefs });
}

export async function accountSummary(): Promise<AccountSummary> {
  const [session, prefs] = await Promise.all([loadSession(), loadPrefs()]);
  return {
    signedIn: session !== null,
    email: session?.email ?? null,
    paid: session?.paid ?? false,
    expiresAt: session?.expiresAt ?? null,
    copyPreference: prefs.copyPreference,
  };
}

/** Live links on this device, newest first. */
export async function loadLinks(): Promise<ShareLink[]> {
  const { [LINKS_KEY]: links } = await chrome.storage.local.get(LINKS_KEY);
  if (!Array.isArray(links)) return [];
  const now = Date.now();
  return (links as ShareLink[]).filter(
    (link) => link && typeof link.url === "string" && !isExpired(link.expiresAt, now),
  );
}

/**
 * Adds or refreshes links (by id), drops expired ones, and keeps newest first.
 * The side panel also merges the server's list in, so the fallback history
 * includes links made on other devices once they have been seen here.
 */
export async function rememberLinks(incoming: ShareLink[]): Promise<ShareLink[]> {
  const byId = new Map<string, ShareLink>();
  for (const link of await loadLinks()) byId.set(link.id, link);
  for (const link of incoming) {
    byId.set(link.id, {
      id: link.id,
      url: link.url,
      size: link.size,
      uploadedAt: link.uploadedAt,
      expiresAt: link.expiresAt,
    });
  }
  const now = Date.now();
  const links = [...byId.values()]
    .filter((link) => !isExpired(link.expiresAt, now))
    .sort((a, b) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt))
    .slice(0, MAX_LINKS);
  await chrome.storage.local.set({ [LINKS_KEY]: links });
  return links;
}
