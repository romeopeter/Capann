/**
 * links-panel.tsx — the side panel's "Links" tab (Premium build only).
 *
 * Shows every live link with a countdown to its expiry (RETENTION_DAYS). Two sources:
 *
 * - the server (`GET /api/links/list`) when signed in: links from every device
 * - `capann_links` in chrome.storage.local: links made or seen in this browser,
 *   the zero-auth fallback shown when signed out or offline
 *
 * Server results are merged into the local history, so the fallback improves
 * every time the panel syncs. The same page opens in a tab when Chrome won't
 * open the side panel (see `openLinks` in background/premium.ts).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CopyIcon,
  LinkSimpleIcon,
} from "@phosphor-icons/react";
import { API_URL } from "../shared/features";
import { ApiError, listLinks, requestMagicLink } from "@capann/api-client";
import { RETENTION_DAYS } from "@capann/contract";
import {
  LINKS_KEY,
  SESSION_KEY,
  clearSession,
  loadLinks,
  loadSession,
  rememberLinks,
} from "../shared/premium/store";
import type { ShareLink } from "../shared/types";

type Sync = "loading" | "synced" | "offline" | "signed-out";

type Recovery =
  | { step: "open"; error: string }
  | { step: "sending" }
  | { step: "sent"; email: string };

const TICK_MS = 30_000;
const COPIED_MS = 1_600;
const DAY_MS = 86_400_000;

function timeLeft(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes % 60}m left`;
  return `${Math.max(1, minutes)}m left`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const BUTTON: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid var(--border-hairline)",
  background: "var(--surface-elevated)",
  fontSize: 12,
  fontWeight: 500,
};

const MUTED: CSSProperties = { margin: 0, color: "var(--text-muted)", fontSize: 12 };

function LinkRow({
  link,
  now,
  copied,
  onCopy,
}: {
  link: ShareLink;
  now: number;
  copied: boolean;
  onCopy: () => void;
}) {
  const left = Date.parse(link.expiresAt) - now;
  return (
    <li
      className="row"
      style={{
        listStyle: "none",
        minWidth: 0,
        padding: 12,
        borderRadius: 16,
        background: "var(--surface-base)",
        border: "1px solid var(--border-hairline)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <strong style={{ fontWeight: 500, fontSize: 13 }}>
          {dateFormat.format(new Date(link.uploadedAt))}
        </strong>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11,
            fontVariantNumeric: "tabular-nums",
            color: left < DAY_MS ? "#F5E8A6" : "var(--text-muted)",
          }}
        >
          {timeLeft(left)}
        </span>
      </div>
      <p
        title={link.url}
        style={{
          ...MUTED,
          marginTop: 2,
          fontSize: 11,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {formatBytes(link.size)} · {link.url.replace(/^https?:\/\//, "")}
      </p>
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button
          type="button"
          onClick={onCopy}
          style={{
            ...BUTTON,
            borderColor: copied ? "rgba(134,239,172,0.45)" : "var(--border-hairline)",
            color: copied ? "var(--accent-mint)" : "var(--text-primary)",
            transition: "border-color 180ms var(--ease-morph), color 180ms var(--ease-morph)",
          }}
        >
          {copied ? (
            <span className="pop" style={{ display: "inline-flex" }}>
              <CheckCircleIcon size={14} weight="fill" />
            </span>
          ) : (
            <CopyIcon size={14} />
          )}
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ ...BUTTON, color: "var(--text-primary)", textDecoration: "none" }}
        >
          <ArrowSquareOutIcon size={14} />
          Open
        </a>
      </div>
    </li>
  );
}

export function LinksPanel() {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [sync, setSync] = useState<Sync>("loading");
  const [now, setNow] = useState(() => Date.now());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<Recovery>({ step: "open", error: "" });
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const copiedTimer = useRef(0);
  // Only the newest sync may write state; an older one can finish later.
  const syncId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++syncId.current;
    const [session, local] = await Promise.all([loadSession(), loadLinks()]);
    if (id !== syncId.current) return;
    setLinks(local);
    setEmail(session?.email ?? null);
    if (session) setRecoveryEmail((current) => current || session.email);
    if (!session) {
      setSync("signed-out");
      return;
    }
    setSync("loading");
    try {
      const response = await listLinks(API_URL, session.token);
      const merged = await rememberLinks(response.items);
      if (id !== syncId.current) return;
      setLinks(merged);
      setSync("synced");
    } catch (error) {
      if (id !== syncId.current) return;
      if (error instanceof ApiError && error.status === 401) {
        await clearSession();
        setSync("signed-out");
      } else {
        setSync("offline");
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== "local") return;
      if (SESSION_KEY in changes) void refresh();
      // A link made while the panel is open; reload the local list only.
      else if (LINKS_KEY in changes) void loadLinks().then(setLinks);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNow(Date.now());
        void refresh();
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    document.addEventListener("visibilitychange", onVisible);
    const tick = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(tick);
      window.clearTimeout(copiedTimer.current);
    };
  }, [refresh]);

  const copy = (link: ShareLink) => {
    void navigator.clipboard.writeText(link.url).then(() => {
      setCopiedId(link.id);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopiedId(null), COPIED_MS);
    });
  };

  const sendRecovery = async (event: FormEvent) => {
    event.preventDefault();
    const address = recoveryEmail.trim();
    if (!address) return;
    setRecovery({ step: "sending" });
    try {
      await requestMagicLink(API_URL, address, "links");
      setRecovery({ step: "sent", email: address });
    } catch (error) {
      let message = "Capann couldn't send the email. Try again.";
      if (error instanceof ApiError) {
        message = error.message;
        if (error.retryAfter) {
          const minutes = Math.ceil(error.retryAfter / 60);
          message += ` Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
        }
      }
      setRecovery({ step: "open", error: message });
    }
  };

  const live = links.filter((link) => Date.parse(link.expiresAt) > now);

  return (
    <div>
      <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>Your links</h2>
          <p style={{ ...MUTED, fontSize: 11 }}>Shared recordings stay up for {RETENTION_DAYS} days.</p>
        </div>
        {email && (
          <span
            title={email}
            style={{
              ...MUTED,
              fontSize: 11,
              marginLeft: "auto",
              maxWidth: "45%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {email}
          </span>
        )}
      </header>

      {sync === "offline" && (
        <p role="status" style={{ ...MUTED, marginTop: 16, color: "#F5E8A6" }}>
          Couldn't reach Capann — showing links saved in this browser.
        </p>
      )}
      {sync === "signed-out" && (
        <p role="status" style={{ ...MUTED, marginTop: 16 }}>
          Showing links saved in this browser. Sign in from Capann's Record view to see
          links from all your devices.
        </p>
      )}

      {live.length > 0 ? (
        <ul
          style={{
            display: "grid",
            // minmax(0, …): a long URL must truncate, not widen the column.
            gridTemplateColumns: "minmax(0, 1fr)",
            gap: 8,
            margin: "16px 0 0",
            padding: 0,
          }}
        >
          {live.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              now={now}
              copied={copiedId === link.id}
              onCopy={() => copy(link)}
            />
          ))}
        </ul>
      ) : (
        <div
          style={{
            marginTop: 16,
            padding: "28px 16px",
            borderRadius: 16,
            border: "1px dashed var(--border-strong)",
            textAlign: "center",
          }}
        >
          <LinkSimpleIcon size={22} color="#A78BFA" weight="bold" />
          <p style={{ margin: "8px 0 2px", fontWeight: 500 }}>
            {sync === "loading" ? "Loading links…" : "No links yet"}
          </p>
          <p style={MUTED}>
            Stop a recording while signed in to Premium and its link appears here.
          </p>
        </div>
      )}

      <section
        style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: "1px solid var(--border-hairline)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>Lost a link?</h2>
        <p style={{ ...MUTED, marginTop: 2 }}>
          We'll email you a page with every recording you've shared in the last {RETENTION_DAYS} days,
          from any device.
        </p>
        {recovery.step === "sent" ? (
          <div role="status" style={{ marginTop: 10 }}>
            <p style={{ margin: 0, color: "var(--accent-mint)", fontSize: 12 }}>
              Check your inbox
            </p>
            <p style={{ ...MUTED, marginTop: 2 }}>
              We sent a link to {recovery.email}. It works for 15 minutes.
            </p>
            <button
              type="button"
              onClick={() => setRecovery({ step: "open", error: "" })}
              style={{
                background: "none",
                border: 0,
                padding: 0,
                marginTop: 6,
                color: "var(--accent-violet)",
                fontSize: 12,
              }}
            >
              Send another
            </button>
          </div>
        ) : (
          <form onSubmit={(event) => void sendRecovery(event)} style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                aria-label="Email address"
                value={recoveryEmail}
                disabled={recovery.step === "sending"}
                onChange={(event) => setRecoveryEmail(event.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 34,
                  padding: "0 10px",
                  borderRadius: 10,
                  border: "1px solid var(--border-strong)",
                  background: "rgba(255,255,255,0.06)",
                  fontSize: 12,
                }}
              />
              <button
                type="submit"
                disabled={recovery.step === "sending"}
                style={{
                  ...BUTTON,
                  border: 0,
                  background: "var(--accent-violet)",
                  color: "#17131F",
                  fontWeight: 700,
                  opacity: recovery.step === "sending" ? 0.65 : 1,
                }}
              >
                {recovery.step === "sending" ? "Sending…" : "Email me"}
              </button>
            </div>
            {recovery.step === "open" && recovery.error && (
              <p role="alert" style={{ ...MUTED, marginTop: 6, color: "var(--danger)" }}>
                {recovery.error}
              </p>
            )}
          </form>
        )}
      </section>
    </div>
  );
}
