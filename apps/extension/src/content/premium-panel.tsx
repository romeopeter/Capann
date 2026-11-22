/**
 * premium-panel.tsx
 *
 * Premium pieces of the Record view: the account row, the share card (upload
 * progress, link, auto-copy), the "Save a copy?" dialog, and the free build's
 * one teaser link.
 *
 * Recording-only: nothing here touches annotations or the capture-hide
 * invariant. The page never holds the session token; it asks the worker for an
 * `AccountSummary` and sends Premium actions as messages.
 *
 * Both hooks are always called (Rules of Hooks) and do nothing in the free
 * build, where `PREMIUM_ENABLED` is false.
 */

import { RETENTION_DAYS } from "@capann/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from "react";
import {
  CheckCircleIcon,
  CopyIcon,
  ArrowSquareOutIcon,
  LinkSimpleIcon,
} from "@phosphor-icons/react";
import {
  PREMIUM_ENABLED,
  PREMIUM_PRICE_LABEL,
  PRICING_URL,
} from "../shared/features";
import { PREFS_KEY, SESSION_KEY } from "../shared/premium/store";
import type {
  AccountSummary,
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  CopyPreference,
  PremiumActionResult,
  ShareJobStatus,
} from "../shared/types";
import { SHELL_BUTTON } from "./shell";

const MOTION = "180ms cubic-bezier(0.2, 0.8, 0.2, 1)";
const FONT = "Manrope, Inter, system-ui, sans-serif";

/** If the offscreen document dies mid-upload, no final status ever arrives. */
const SHARE_STALL_MS = 90_000;

/**
 * Message the worker. Resolves null when the extension was reloaded under
 * this page (the context is invalidated) instead of throwing into React.
 */
function ask<T>(message: ContentToBackgroundMessage): Promise<T | null> {
  try {
    return chrome.runtime.sendMessage(message).then(
      (response) => (response ?? null) as T | null,
      () => null,
    );
  } catch {
    return Promise.resolve(null);
  }
}

function isAccount(value: unknown): value is AccountSummary {
  return Boolean(value) && typeof (value as AccountSummary).signedIn === "boolean";
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * The account as the page may see it. `active` (the Record view is open)
 * re-checks `paid` with the server on open and whenever the window regains
 * focus, which is how an upgrade made in the checkout tab shows up here.
 */
export function usePremiumAccount(active: boolean) {
  const [account, setAccount] = useState<AccountSummary | null>(null);

  const load = useCallback((refresh: boolean, force = false) => {
    if (!PREMIUM_ENABLED) return;
    void ask<AccountSummary>({ kind: "premium-account", refresh, force }).then((next) => {
      if (isAccount(next)) setAccount(next);
    });
  }, []);

  useEffect(() => {
    if (!PREMIUM_ENABLED) return;
    load(false);
    // Sign-in completes on the website, in another tab: the worker stores the
    // session and this page hears about it through storage.
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && (SESSION_KEY in changes || PREFS_KEY in changes)) load(false);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

  useEffect(() => {
    if (!PREMIUM_ENABLED || !active) return;
    load(true);
    const onFocus = () => load(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [active, load]);

  return { account, setAccount, reload: load };
}

export type ClipboardState = "idle" | "copied" | "failed";

/** Writes text to the clipboard, falling back to execCommand inside a click. */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Not focused, or the page's permissions policy blocks the async API.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.documentElement.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * The latest share job for this tab, as relayed by the worker. The link is
 * copied to the clipboard once, as soon as it exists. That needs this page to
 * have focus; if it doesn't, the card offers a Copy button instead.
 */
export function useShareJob() {
  const [status, setStatus] = useState<ShareJobStatus | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState>("idle");
  const sessionRef = useRef<string | null>(null);
  const autoCopiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!PREMIUM_ENABLED) return;
    const onMessage = (message: BackgroundToContentMessage) => {
      if (message.kind !== "share-status") return;
      if (sessionRef.current !== message.status.sessionId) {
        sessionRef.current = message.status.sessionId;
        setClipboard("idle");
      }
      setStatus(message.status);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const link = status?.upload.state === "uploaded" ? status.upload.link.url : null;

  useEffect(() => {
    if (!link || autoCopiedRef.current === link) return;
    autoCopiedRef.current = link;
    let cancelled = false;
    void navigator.clipboard.writeText(link).then(
      () => !cancelled && setClipboard("copied"),
      () => !cancelled && setClipboard("failed"),
    );
    return () => {
      cancelled = true;
    };
  }, [link]);

  // Every status update restarts the timer; only a silent job trips it.
  const stalled = status !== null && !status.done && status.upload.state === "uploading";
  useEffect(() => {
    if (!stalled) return;
    const timer = window.setTimeout(() => {
      setStatus((current) =>
        current === status && current
          ? {
              ...current,
              upload: {
                state: "failed",
                code: "NETWORK",
                error:
                  "The upload stopped responding. Check Downloads for a copy; if there isn't one, record again.",
              },
              done: true,
            }
          : current,
      );
    }, SHARE_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [status, stalled]);

  const copyLink = useCallback(() => {
    if (!link) return;
    void writeClipboard(link).then((ok) => setClipboard(ok ? "copied" : "failed"));
  }, [link]);

  const answerCopy = useCallback(
    (save: boolean, remember: boolean) => {
      if (!status || status.copy !== "ask") return;
      void ask({
        kind: "share-copy-choice",
        sessionId: status.sessionId,
        save,
        remember,
      });
      // Optimistic: the recorder confirms with the next status.
      setStatus({ ...status, copy: save ? "saving" : "skipped" });
    },
    [status],
  );

  const clear = useCallback(() => {
    sessionRef.current = null;
    setStatus(null);
    setClipboard("idle");
  }, []);

  return { status, clipboard, copyLink, answerCopy, clear };
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const TEXT_BUTTON: CSSProperties = {
  background: "none",
  border: 0,
  padding: 0,
  whiteSpace: "nowrap",
  color: "#A78BFA",
  font: `500 11px/1.4 ${FONT}`,
  cursor: "pointer",
};

const SMALL_BUTTON: CSSProperties = {
  ...SHELL_BUTTON,
  padding: "8px 12px",
  borderRadius: 12,
  fontSize: 12,
};

const MUTED: CSSProperties = { margin: 0, color: "#8B8B93", fontSize: 11, lineHeight: 1.45 };

/** Keep typed keys out of the page: sites bind single-letter shortcuts. */
const isolateKeys = (event: ReactKeyboardEvent) => event.stopPropagation();

/** Keyframes and focus rings used below; rendered once with the Record view. */
export function PremiumStyles() {
  return (
    <style>{`
      @keyframes capann-pop {
        0% { transform: scale(0.6); opacity: 0; }
        60% { transform: scale(1.12); opacity: 1; }
        100% { transform: scale(1); }
      }
      @keyframes capann-glow {
        0% { box-shadow: 0 0 0 0 rgba(134, 239, 172, 0.55); }
        100% { box-shadow: 0 0 0 8px rgba(134, 239, 172, 0); }
      }
      @keyframes capann-dialog-in {
        from { opacity: 0; transform: translateY(4px) scale(0.98); }
        to { opacity: 1; transform: none; }
      }
      .capann-pop { animation: capann-pop 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
      .capann-glow { animation: capann-glow 700ms cubic-bezier(0.2, 0.8, 0.2, 1) 1; }
      .capann-input:focus-visible { outline: none; border-color: #A78BFA; }
      .capann-premium button:focus-visible,
      .capann-premium a:focus-visible {
        outline: 2px solid #A78BFA;
        outline-offset: 2px;
        border-radius: 6px;
      }
      @media (prefers-reduced-motion: reduce) {
        .capann-pop, .capann-glow { animation: none; }
      }
    `}</style>
  );
}

function Divider() {
  return (
    <div
      aria-hidden="true"
      style={{ height: 1, background: "rgba(255,255,255,0.08)", margin: "14px 0 12px" }}
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function waitMessage(result: PremiumActionResult): string {
  if (result.ok) return "";
  if (result.retryAfter) {
    const minutes = Math.ceil(result.retryAfter / 60);
    return `${result.error} Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  return result.error;
}

// ── Account row ───────────────────────────────────────────────────────────────

const COPY_CHOICES: [CopyPreference, string][] = [
  ["ask", "Ask"],
  ["always", "Always"],
  ["never", "Never"],
];

/** "Local copy: Ask / Always / Never", the remembered answer to the dialog. */
function CopyPreferenceControl({
  value,
  onChange,
}: {
  value: CopyPreference;
  onChange: (value: CopyPreference) => void;
}) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
    >
      <span style={{ fontSize: 12, color: "#F5F5F7", whiteSpace: "nowrap" }}>Keep a copy</span>
      <div
        role="radiogroup"
        aria-label="Save a local copy"
        style={{
          display: "flex",
          padding: 2,
          borderRadius: 999,
          background: "rgba(255,255,255,0.08)",
        }}
      >
        {COPY_CHOICES.map(([choice, label]) => {
          const selected = value === choice;
          return (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(choice)}
              style={{
                border: 0,
                borderRadius: 999,
                padding: "4px 8px",
                background: selected ? "#A78BFA" : "transparent",
                color: selected ? "#17131F" : "#8B8B93",
                font: `500 11px/1.2 ${FONT}`,
                cursor: "pointer",
                transition: `background-color ${MOTION}, color ${MOTION}`,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type SignInState =
  | { step: "closed" }
  | { step: "open"; error: string }
  | { step: "sending" }
  | { step: "sent"; email: string };

/**
 * Bottom of the Record view in the Premium build: sign in, upgrade, links,
 * and the local-copy preference.
 */
export function AccountSection({
  account,
  onAccount,
  onRefresh,
  nudge,
}: {
  account: AccountSummary | null;
  onAccount: (account: AccountSummary) => void;
  onRefresh: () => void;
  /** A recording was just saved as a file; suggest a link next time. */
  nudge: boolean;
}) {
  const [signIn, setSignIn] = useState<SignInState>({ step: "closed" });
  const [email, setEmail] = useState("");
  const [actionError, setActionError] = useState("");
  const [upgrading, setUpgrading] = useState(false);

  // A completed sign-in (from the website) replaces the "check your inbox" note.
  const signedIn = account?.signedIn ?? false;
  useEffect(() => {
    if (signedIn) setSignIn({ step: "closed" });
  }, [signedIn]);

  const send = async () => {
    const address = email.trim();
    if (!address) return;
    setSignIn({ step: "sending" });
    const result = await ask<PremiumActionResult>({ kind: "premium-sign-in", email: address });
    if (result?.ok) setSignIn({ step: "sent", email: address });
    else
      setSignIn({
        step: "open",
        error: result ? waitMessage(result) : "Capann couldn't send the email. Try again.",
      });
  };

  const upgrade = async () => {
    setUpgrading(true);
    setActionError("");
    const result = await ask<PremiumActionResult>({ kind: "premium-upgrade" });
    setUpgrading(false);
    if (!result?.ok) setActionError(result ? waitMessage(result) : "Couldn't open checkout.");
  };

  const signOut = async () => {
    const next = await ask<AccountSummary>({ kind: "premium-sign-out" });
    if (isAccount(next)) onAccount(next);
  };

  const setPreference = async (preference: CopyPreference) => {
    const next = await ask<AccountSummary>({ kind: "premium-copy-preference", preference });
    if (isAccount(next)) onAccount(next);
  };

  const openLinks = () => void ask({ kind: "premium-open-links" });

  if (!account) return null;

  const links = (
    <button type="button" style={TEXT_BUTTON} onClick={openLinks}>
      My links
    </button>
  );

  if (!account.signedIn) {
    return (
      <div className="capann-premium">
        <Divider />
        {nudge && (
          <p style={{ ...MUTED, color: "#C4B5FD", marginBottom: 8 }}>
            Want a link instead of a file? Sign in to share your next recording.
          </p>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <LinkSimpleIcon size={16} weight="bold" color="#A78BFA" />
          <strong style={{ fontWeight: 500 }}>Share recordings as links</strong>
        </div>
        <p style={{ ...MUTED, margin: "4px 0 10px" }}>
          Premium uploads each recording and copies a link that works for {RETENTION_DAYS} days.
        </p>
        {signIn.step === "sent" ? (
          <div role="status">
            <p style={{ margin: 0, fontSize: 12, color: "#86EFAC" }}>Check your inbox</p>
            <p style={{ ...MUTED, margin: "2px 0 6px" }}>
              We sent a sign-in link to {signIn.email}. Open it in this browser to finish.
            </p>
            <button
              type="button"
              style={TEXT_BUTTON}
              onClick={() => setSignIn({ step: "open", error: "" })}
            >
              Use a different email
            </button>
          </div>
        ) : signIn.step === "closed" ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <button
              type="button"
              style={SMALL_BUTTON}
              onClick={() => setSignIn({ step: "open", error: "" })}
            >
              Sign in with email
            </button>
            {links}
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="capann-input"
                type="email"
                required
                autoFocus
                autoComplete="email"
                placeholder="you@example.com"
                aria-label="Email address"
                value={email}
                disabled={signIn.step === "sending"}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={isolateKeys}
                onKeyUp={isolateKeys}
                onKeyPress={isolateKeys}
                style={{
                  flex: 1,
                  minWidth: 0,
                  boxSizing: "border-box",
                  height: 34,
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#F5F5F7",
                  padding: "0 10px",
                  font: `400 12px/1 ${FONT}`,
                  transition: `border-color ${MOTION}`,
                }}
              />
              <button
                type="submit"
                disabled={signIn.step === "sending"}
                style={{
                  ...SMALL_BUTTON,
                  background: "#A78BFA",
                  border: 0,
                  color: "#17131F",
                  fontWeight: 700,
                  opacity: signIn.step === "sending" ? 0.65 : 1,
                  cursor: signIn.step === "sending" ? "wait" : "pointer",
                }}
              >
                {signIn.step === "sending" ? "Sending…" : "Send link"}
              </button>
            </div>
            {signIn.step === "open" && signIn.error && (
              <p role="alert" style={{ ...MUTED, color: "#FCA5A5", marginTop: 6 }}>
                {signIn.error}
              </p>
            )}
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="capann-premium">
      <Divider />
      {nudge && !account.paid && (
        <p style={{ ...MUTED, color: "#C4B5FD", marginBottom: 8 }}>
          Want a link instead of a file? Upgrade to share your next recording.
        </p>
      )}
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
      >
        <span
          title={account.email ?? undefined}
          style={{
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 12,
          }}
        >
          {account.email}
        </span>
        <span
          style={{
            flex: "0 0 auto",
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 500,
            color: account.paid ? "#17131F" : "#8B8B93",
            background: account.paid ? "#A78BFA" : "rgba(255,255,255,0.08)",
          }}
        >
          {account.paid ? "Premium" : "Free plan"}
        </span>
      </div>

      {account.paid ? (
        <>
          <p style={{ ...MUTED, margin: "6px 0 10px" }}>
            Stopping a recording uploads it and copies its link.
          </p>
          <CopyPreferenceControl
            value={account.copyPreference}
            onChange={(choice) => void setPreference(choice)}
          />
        </>
      ) : (
        <button
          type="button"
          onClick={() => void upgrade()}
          disabled={upgrading}
          style={{
            ...SMALL_BUTTON,
            width: "100%",
            marginTop: 10,
            background: "#86EFAC",
            border: 0,
            color: "#0A2E1B",
            fontWeight: 700,
            opacity: upgrading ? 0.65 : 1,
            cursor: upgrading ? "wait" : "pointer",
          }}
        >
          {upgrading ? "Opening checkout…" : `Upgrade · ${PREMIUM_PRICE_LABEL}`}
        </button>
      )}
      {!account.paid && (
        <p style={{ ...MUTED, marginTop: 6, textAlign: "center" }}>
          Already upgraded?{" "}
          <button type="button" style={TEXT_BUTTON} onClick={onRefresh}>
            Refresh
          </button>
        </p>
      )}
      {actionError && (
        <p role="alert" style={{ ...MUTED, color: "#FCA5A5", marginTop: 6 }}>
          {actionError}
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", marginTop: 10 }}>
        {links}
        <button
          type="button"
          style={{ ...TEXT_BUTTON, color: "#8B8B93", marginLeft: "auto" }}
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

// ── Share card ────────────────────────────────────────────────────────────────

function copyNote(status: ShareJobStatus): string | null {
  switch (status.copy) {
    case "saving":
      return "Saving a copy to your computer…";
    case "saved":
      return status.upload.state === "failed"
        ? "Saved to your computer instead."
        : "A copy is in your Downloads.";
    case "failed":
      return "The local copy couldn't be saved — check your download settings.";
    default:
      return null;
  }
}

/** Upload progress, then the link, then any failure and its recovery. */
export function ShareCard({
  status,
  clipboard,
  onCopy,
}: {
  status: ShareJobStatus;
  clipboard: ClipboardState;
  onCopy: () => void;
}) {
  const { upload } = status;
  const note = copyNote(status);

  if (upload.state === "uploading") {
    const percent = upload.total ? Math.floor((upload.loaded / upload.total) * 100) : 0;
    return (
      <div role="status" style={{ marginTop: 14 }}>
        <div
          style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}
        >
          <span>Creating your link…</span>
          <span style={{ color: "#8B8B93", fontVariantNumeric: "tabular-nums" }}>
            {percent}%
          </span>
        </div>
        <div
          aria-hidden="true"
          style={{
            height: 4,
            marginTop: 8,
            borderRadius: 999,
            background: "rgba(255,255,255,0.12)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: "100%",
              borderRadius: 999,
              background: "#A78BFA",
              transition: `width ${MOTION}`,
            }}
          />
        </div>
        <p style={{ ...MUTED, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
          {formatBytes(upload.loaded)} of {formatBytes(upload.total)}
        </p>
        {note && <p style={{ ...MUTED, marginTop: 4 }}>{note}</p>}
      </div>
    );
  }

  if (upload.state === "failed") {
    return (
      <div style={{ marginTop: 14 }}>
        <p role="alert" style={{ margin: 0, color: "#FCA5A5", fontSize: 12 }}>
          {upload.error}
        </p>
        {note && (
          <p
            style={{
              ...MUTED,
              marginTop: 4,
              color: status.copy === "saved" ? "#86EFAC" : MUTED.color,
            }}
          >
            {note}
          </p>
        )}
      </div>
    );
  }

  const { link } = upload;
  const copied = clipboard === "copied";
  return (
    <div style={{ marginTop: 14 }}>
      <div
        role="status"
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}
      >
        <span
          key={copied ? "copied" : "ready"}
          className="capann-pop"
          style={{ display: "inline-flex" }}
        >
          <CheckCircleIcon size={18} weight="fill" color="#86EFAC" />
        </span>
        <strong style={{ fontWeight: 500 }}>{copied ? "Link copied" : "Link ready"}</strong>
        <span style={{ marginLeft: "auto", ...MUTED }}>Expires in {RETENTION_DAYS} days</span>
      </div>
      <div
        key={copied ? "glow" : "plain"}
        className={copied ? "capann-glow" : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginTop: 8,
          padding: "4px 4px 4px 10px",
          borderRadius: 12,
          border: `1px solid ${copied ? "rgba(134,239,172,0.45)" : "rgba(255,255,255,0.15)"}`,
          background: "rgba(255,255,255,0.06)",
          transition: `border-color ${MOTION}`,
        }}
      >
        <span
          title={link.url}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 11,
            color: "#C9C9D1",
          }}
        >
          {link.url.replace(/^https?:\/\//, "")}
        </span>
        <IconButton label={copied ? "Copy again" : "Copy link"} onClick={onCopy}>
          <CopyIcon size={15} />
        </IconButton>
        <IconButton
          label="Open link"
          onClick={() => window.open(link.url, "_blank", "noopener,noreferrer")}
        >
          <ArrowSquareOutIcon size={15} />
        </IconButton>
      </div>
      {clipboard === "failed" && (
        <p style={{ ...MUTED, marginTop: 6 }}>
          Click the copy button to put the link on your clipboard.
        </p>
      )}
      {note && <p style={{ ...MUTED, marginTop: 6 }}>{note}</p>}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        flex: "0 0 auto",
        display: "grid",
        placeItems: "center",
        border: 0,
        borderRadius: 10,
        background: "transparent",
        color: "#F5F5F7",
        cursor: "pointer",
        transition: `background-color ${MOTION}`,
      }}
      onMouseEnter={(event) => (event.currentTarget.style.background = "#26262B")}
      onMouseLeave={(event) => (event.currentTarget.style.background = "transparent")}
    >
      {children}
    </button>
  );
}

// ── "Save a copy?" dialog ─────────────────────────────────────────────────────

/**
 * Covers the Record view while the presenter decides. The upload keeps going
 * underneath; the answer only decides whether the .webm also goes to Downloads.
 */
export function CopyDialog({
  uploaded,
  onAnswer,
}: {
  uploaded: boolean;
  onAnswer: (save: boolean, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  return (
    <div
      className="capann-premium"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="capann-copy-title"
      aria-describedby="capann-copy-body"
      style={{
        position: "absolute",
        inset: -6,
        zIndex: 2,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 16,
        borderRadius: 18,
        // Opaque: the controls underneath must not read through the question.
        background: "#1C1C20",
        border: "1px solid rgba(255,255,255,0.15)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
        animation: "capann-dialog-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
      }}
    >
      <strong id="capann-copy-title" style={{ fontSize: 14, fontWeight: 500 }}>
        Save a copy to your computer?
      </strong>
      <p id="capann-copy-body" style={{ ...MUTED, margin: "6px 0 14px" }}>
        {uploaded
          ? "Your link is ready either way. A copy goes to your Downloads folder."
          : "Your link is being created either way. A copy goes to your Downloads folder."}
      </p>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: "#C9C9D1",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
          style={{ accentColor: "#A78BFA", margin: 0 }}
        />
        Don't ask again
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button
          type="button"
          style={{ ...SMALL_BUTTON, flex: 1 }}
          onClick={() => onAnswer(false, remember)}
        >
          No thanks
        </button>
        <button
          type="button"
          autoFocus
          style={{
            ...SMALL_BUTTON,
            flex: 1,
            background: "#86EFAC",
            border: 0,
            color: "#0A2E1B",
            fontWeight: 700,
          }}
          onClick={() => onAnswer(true, remember)}
        >
          Save copy
        </button>
      </div>
      {remember && (
        <p style={{ ...MUTED, marginTop: 8 }}>
          You can change this under "Keep a copy" below.
        </p>
      )}
    </div>
  );
}

// ── Free build ────────────────────────────────────────────────────────────────

/**
 * The free build's only mention of Premium: a plain link to the pricing page.
 * No request is made; the browser just opens the site in a new tab.
 */
export function FreeTeaser({ saved }: { saved: boolean }) {
  return (
    <div className="capann-premium">
      <Divider />
      <a
        href={PRICING_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "#C4B5FD",
          fontSize: 11,
          textDecoration: "none",
        }}
      >
        <LinkSimpleIcon size={14} weight="bold" />
        {saved
          ? "Want a link instead of a file? Capann Premium →"
          : "Share recordings as links with Capann Premium →"}
      </a>
    </div>
  );
}
