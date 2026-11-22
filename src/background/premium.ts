/**
 * Premium (shareable links) in the service worker.
 *
 * Owns the account: the session token never leaves the worker, the side
 * panel, or the stop command to the offscreen document. Pages get an
 * `AccountSummary`. The worker is also the only listener for the website's
 * hand-off (`externally_connectable`), and it relays share-job progress from
 * the offscreen document to the tab that recorded.
 *
 * Nothing here runs in the free build: `service-worker.ts` routes to it only
 * when `PREMIUM_ENABLED`.
 */

import { API_URL, EDITION, SITE_URL } from "../shared/features";
import {
  ApiError,
  getSession,
  requestMagicLink,
  startCheckout,
} from "../shared/premium/api";
import {
  accountSummary,
  clearSession,
  loadPrefs,
  loadSession,
  rememberLinks,
  saveCopyPreference,
  saveSession,
} from "../shared/premium/store";
import { openSidePanel } from "./side-panel";
import type {
  AccountSummary,
  BackgroundToContentMessage,
  BackgroundToRecorderMessage,
  ContentToBackgroundMessage,
  PremiumActionResult,
  ShareJobStatus,
  ShareRequest,
  WebsiteToExtensionMessage,
} from "../shared/types";

/** Re-check `paid` with the server at most this often for passive refreshes. */
const REFRESH_INTERVAL_MS = 10_000;

function failure(error: unknown, fallback: string): PremiumActionResult {
  if (error instanceof ApiError) {
    return { ok: false, error: error.message, retryAfter: error.retryAfter };
  }
  return { ok: false, error: fallback };
}

/**
 * Confirms the stored session with the server. A 401 means the token is no
 * longer valid (expired, or the secret was rotated): sign out. Any other
 * failure keeps the cached claims, so being offline doesn't sign anyone out.
 */
export async function refreshAccount(force: boolean): Promise<AccountSummary> {
  const session = await loadSession();
  if (session && (force || Date.now() - session.checkedAt >= REFRESH_INTERVAL_MS)) {
    try {
      await saveSession(await getSession(API_URL, session.token));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await clearSession();
    }
  }
  return accountSummary();
}

/**
 * The share half of a stop command, or undefined to save locally as usual.
 * Uses the cached `paid` claim; the backend re-checks the subscription on
 * upload, and a 402 there falls back to a local save.
 */
export async function shareRequestForStop(): Promise<ShareRequest | undefined> {
  const [session, prefs] = await Promise.all([loadSession(), loadPrefs()]);
  if (!session?.paid) return undefined;
  return { token: session.token, copyPreference: prefs.copyPreference };
}

async function markUnpaid(): Promise<void> {
  const session = await loadSession();
  if (session) await saveSession({ ...session, paid: false });
}

const rememberedLinks = new Set<string>();

/** Relay a share job's progress to its tab, and record what it changed. */
export function handleShareStatus(tabId: number, status: ShareJobStatus): void {
  const message: BackgroundToContentMessage = { kind: "share-status", status };
  void chrome.tabs.sendMessage(tabId, message).catch(() => undefined);

  const { upload } = status;
  if (upload.state === "uploading") {
    const percent = upload.total ? Math.floor((upload.loaded / upload.total) * 100) : 0;
    void chrome.action.setBadgeText({ text: "UP" });
    void chrome.action.setBadgeBackgroundColor({ color: "#A78BFA" });
    void chrome.action.setTitle({ title: `Capann is uploading your recording (${percent}%)` });
    return;
  }
  void chrome.action.setBadgeText({ text: "" });
  void chrome.action.setTitle({
    title:
      upload.state === "uploaded"
        ? "Capann — Link ready"
        : "Capann — Upload failed, recording saved to your computer",
  });
  if (upload.state === "uploaded" && !rememberedLinks.has(upload.link.id)) {
    rememberedLinks.add(upload.link.id);
    void rememberLinks([upload.link]);
  }
  if (upload.state === "failed" && upload.code === "PAYMENT_REQUIRED") void markUnpaid();
  if (upload.state === "failed" && upload.code === "SIGNED_OUT") void clearSession();
}

/** Downloads a share job's local copy; answers once Chrome has started it. */
export function downloadCopy(
  blobUrl: string,
  filename: string,
  sendResponse: (response: { ok: boolean }) => void,
): void {
  chrome.downloads.download({ url: blobUrl, filename, saveAs: false }, () => {
    sendResponse({ ok: !chrome.runtime.lastError });
  });
}

type PremiumContentMessage = Extract<
  ContentToBackgroundMessage,
  { kind: `premium-${string}` | "share-copy-choice" }
>;

function isPremiumMessage(message: { kind: string }): message is PremiumContentMessage {
  return message.kind.startsWith("premium-") || message.kind === "share-copy-choice";
}

/**
 * Handles a page's Premium request. Returns undefined when the message isn't
 * one, otherwise the `onMessage` return value (true = responds later).
 */
export function handlePremiumMessage(
  message: { kind: string },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean | undefined {
  if (!isPremiumMessage(message)) return undefined;
  const reply = (promise: Promise<unknown>) => {
    void promise.then(sendResponse, () => sendResponse({ ok: false }));
    return true;
  };
  switch (message.kind) {
    case "premium-account":
      return reply(
        message.refresh ? refreshAccount(message.force === true) : accountSummary(),
      );
    case "premium-sign-in":
      return reply(
        requestMagicLink(API_URL, message.email, "login").then(
          (): PremiumActionResult => ({ ok: true }),
          (error) => failure(error, "Capann couldn't send the email. Try again."),
        ),
      );
    case "premium-sign-out":
      return reply(clearSession().then(accountSummary));
    case "premium-upgrade":
      return reply(
        (async (): Promise<PremiumActionResult> => {
          const session = await loadSession();
          if (!session) return { ok: false, error: "Sign in first, then upgrade." };
          try {
            const { url } = await startCheckout(API_URL, session.token);
            await chrome.tabs.create({ url });
            return { ok: true };
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) await clearSession();
            return failure(error, "Capann couldn't open checkout. Try again.");
          }
        })(),
      );
    case "premium-open-links":
      // Synchronous: sidePanel.open() needs the click's user gesture.
      return reply(openSidePanel(sender, "links"));
    case "premium-copy-preference":
      return reply(saveCopyPreference(message.preference).then(accountSummary));
    case "share-copy-choice": {
      const command: BackgroundToRecorderMessage = {
        kind: "offscreen-share-copy",
        sessionId: message.sessionId,
        save: message.save,
        target: "offscreen",
      };
      // Sent directly, not through ensureOffscreen(): if the document is gone
      // the job is gone too, and creating a fresh recorder would be wrong.
      void chrome.runtime.sendMessage(command).catch(() => undefined);
      return reply(
        message.remember
          ? saveCopyPreference(message.save ? "always" : "never").then(() => ({ ok: true }))
          : Promise.resolve({ ok: true }),
      );
    }
  }
}

/**
 * The website hands over a session after `/verify` (see the website notes in
 * `learn/backend.md`). Only the configured site origin is accepted, and the
 * token is checked with the server before it is stored, so a page can't plant
 * an arbitrary string.
 */
export function registerWebsiteMessaging(): void {
  chrome.runtime.onMessageExternal.addListener(
    (message: WebsiteToExtensionMessage, sender, sendResponse) => {
      if (sender.origin !== SITE_URL || !message || typeof message !== "object") {
        sendResponse({ ok: false, error: "Not allowed." });
        return false;
      }
      if (message.kind === "capann-ping") {
        sendResponse({
          ok: true,
          edition: EDITION,
          version: chrome.runtime.getManifest().version,
        });
        return false;
      }
      if (message.kind === "capann-session" && typeof message.token === "string") {
        void getSession(API_URL, message.token)
          .then(saveSession)
          .then(
            (session) => sendResponse({ ok: true, email: session.email, paid: session.paid }),
            (error) => sendResponse(failure(error, "Capann couldn't confirm this sign-in.")),
          );
        return true;
      }
      if (message.kind === "capann-refresh") {
        void refreshAccount(true).then((account) =>
          sendResponse({ ok: true, signedIn: account.signedIn, paid: account.paid }),
        );
        return true;
      }
      sendResponse({ ok: false, error: "Unknown request." });
      return false;
    },
  );
}
