/**
 * recording-chip.tsx
 *
 * Floating recording controls, mounted in their own shadow host by
 * `overlay.tsx` so they can stay visible while `#capann-host` is hidden for
 * the capture.
 *
 * ── VISIBILITY SEAM ────────────────────────────────────────────────────────
 *
 * `OverlayApp` owns `captureHidden`, which hides the annotation overlay and
 * the Capann panel so they never enter the recording. This file deliberately
 * does NOT use that flag or that host. The chip and its camera preview are
 * part of the tab and are recorded on purpose; they are the presenter's
 * controls and the bottom-right camera bubble.
 *
 * Do not merge the two visibilities. The annotation overlay must stay out of
 * the video; the chip must stay in it. The chip's surface lives in
 * `#capann-recording-host`, a sibling of `#capann-host`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  ArrowsOutSimpleIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  RecordingStatus,
} from "../shared/types";

const CHIP_CSS = `
  .capann-rec-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 11px;
    background: transparent;
    color: #F5F5F7;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }
  .capann-rec-btn:hover:not(:disabled) { background: rgba(255,255,255,0.12); }
  .capann-rec-btn:active:not(:disabled) { background: rgba(255,255,255,0.18); }
  .capann-rec-btn:focus-visible { outline: 2px solid #A78BFA; outline-offset: 2px; }
  .capann-rec-btn:disabled { opacity: 0.35; cursor: default; }
  .capann-camera-resize {
    opacity: 0;
    pointer-events: none;
    transform: translateY(-4px) scale(0.94);
    transition:
      opacity 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
      transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
      background 120ms ease;
  }
  .capann-camera-shell:hover .capann-camera-resize,
  .capann-camera-shell:focus-within .capann-camera-resize {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0) scale(1);
  }
  .capann-camera-resize:hover {
    background: rgba(38,38,43,0.92) !important;
  }
  .capann-camera-resize:focus-visible {
    outline: 2px solid #A78BFA;
    outline-offset: 2px;
  }
  @keyframes capann-rec-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(0.82); }
  }
`;

const CAMERA_BUBBLE_SIZES = { S: 132, M: 196, L: 280 } as const;
type CameraBubbleSize = keyof typeof CAMERA_BUBBLE_SIZES;
const NEXT_CAMERA_BUBBLE_SIZE: Record<CameraBubbleSize, CameraBubbleSize> = {
  S: "M",
  M: "L",
  L: "S",
};

// The chip lives in its own shadow root, so the main overlay's CSS custom
// properties are not inherited. These literals mirror design-tokens.md.
const styles: Record<string, CSSProperties> = {
  chip: {
    position: "fixed",
    left: 16,
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    padding: "10px 8px",
    borderRadius: 20,
    background: "rgba(28,28,32,0.72)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.38)",
    color: "#F5F5F7",
    fontFamily: "Manrope, Inter, system-ui, sans-serif",
    pointerEvents: "auto",
    userSelect: "none",
  },
  recRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "2px 4px 0",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flex: "0 0 auto",
  },
  time: {
    fontSize: 12,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "0.02em",
    lineHeight: 1,
  },
  divider: {
    width: 20,
    height: 1,
    background: "rgba(255,255,255,0.12)",
  },
  cameraShell: {
    position: "fixed",
    right: 16,
    bottom: 16,
    pointerEvents: "auto",
    transition:
      "width 180ms cubic-bezier(0.2, 0.8, 0.2, 1), height 180ms cubic-bezier(0.2, 0.8, 0.2, 1)",
  },
  cameraBubble: {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    overflow: "hidden",
    border: "1px solid rgba(255,255,255,0.92)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
    background: "#0A0A0C",
  },
  cameraImage: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  cameraResize: {
    position: "absolute",
    top: "10%",
    right: "10%",
    display: "flex",
    alignItems: "center",
    gap: 3,
    height: 26,
    padding: "0 8px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(28,28,32,0.78)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    boxShadow: "0 4px 14px rgba(0,0,0,0.32)",
    color: "#F5F5F7",
    fontFamily: "Manrope, Inter, system-ui, sans-serif",
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.04em",
    lineHeight: 1,
    cursor: "pointer",
    zIndex: 2,
  },
};

function isActiveState(status: RecordingStatus): boolean {
  return (
    status.state === "starting" ||
    status.state === "recording" ||
    status.state === "paused"
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function ChipButton({
  label,
  onClick,
  disabled,
  color,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  color?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="capann-rec-btn"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      style={color ? { color } : undefined}
    >
      {children}
    </button>
  );
}

export function RecordingChip() {
  const [status, setStatus] = useState<RecordingStatus>({ state: "idle" });
  const [hasFrame, setHasFrame] = useState(false);
  // Set after Stop or Discard until the terminal status arrives. It prevents a
  // second click (or the other terminal button) from changing the outcome.
  const [finishing, setFinishing] = useState(false);
  const [cameraSize, setCameraSize] = useState<CameraBubbleSize>("M");
  const [now, setNow] = useState(() => Date.now());
  const sessionRef = useRef<string | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingFrameRef = useRef<string | null>(null);
  const frameSeqRef = useRef(0);

  const active = isActiveState(status);
  const paused = status.state === "paused";
  const starting = status.state === "starting";
  const nextCameraSize = NEXT_CAMERA_BUBBLE_SIZE[cameraSize];

  // Decode the recorder's JPEG and paint it into the chip's canvas. A canvas
  // keeps the preview independent of the page's CSP for `img-src data:` and
  // lets us update at 15 fps without re-rendering the React tree.
  const drawPreview = useCallback(async (frameDataUrl: string) => {
    const seq = ++frameSeqRef.current;
    const canvas = frameCanvasRef.current;
    if (!canvas) {
      pendingFrameRef.current = frameDataUrl;
      setHasFrame(true);
      return;
    }
    const comma = frameDataUrl.indexOf(",");
    const base64 = comma >= 0 ? frameDataUrl.slice(comma + 1) : frameDataUrl;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1)
        bytes[i] = binary.charCodeAt(i);
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: "image/jpeg" }),
      );
      // A newer frame arrived while this one decoded; keep the newer one.
      if (seq < frameSeqRef.current) {
        bitmap.close();
        return;
      }
      const context = canvas.getContext("2d");
      if (context) context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
    } catch {
      // A corrupt frame is not worth tearing down the chip over.
    }
  }, []);

  // Keep the newest session id available to the message listener without
  // making the listener depend on (and re-register for) every status tick.
  useEffect(() => {
    sessionRef.current =
      "sessionId" in status ? (status.sessionId ?? null) : null;
  }, [status]);

  useEffect(() => {
    let disposed = false;
    const handleMessage = (message: BackgroundToContentMessage) => {
      if (message.kind === "recording-status") {
        setStatus(message.status);
        // Drop the last camera frame as soon as the session is over (or a new
        // one is starting) so a stale face cannot linger under the next chip.
        if (!isActiveState(message.status) || message.status.state === "starting") {
          frameSeqRef.current += 1;
          pendingFrameRef.current = null;
          setHasFrame(false);
          setFinishing(false);
        }
        return;
      }
      if (message.kind === "camera-preview-frame") {
        const session = sessionRef.current;
        if (session === null || session === message.sessionId) {
          void drawPreview(message.dataUrl);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    // A page reload while a recording is running starts a fresh content
    // script; ask the worker for the live status so the chip reappears.
    void chrome.runtime
      .sendMessage({ kind: "get-recording-status" })
      .then((response) => {
        if (!disposed && response) setStatus(response as RecordingStatus);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [drawPreview]);

  // The first frame arrives before the canvas is mounted; paint it once the
  // bubble appears.
  useEffect(() => {
    if (!hasFrame) return;
    const pending = pendingFrameRef.current;
    if (pending && frameCanvasRef.current) {
      pendingFrameRef.current = null;
      void drawPreview(pending);
    }
  }, [hasFrame, drawPreview]);

  // The worker broadcasts a status once per second while recording, but the
  // chip's clock ticks locally so the seconds stay smooth between messages.
  useEffect(() => {
    if (status.state !== "recording") return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [status.state]);

  if (!active) return null;

  const elapsedMs = paused
    ? status.elapsedMs
    : status.state === "recording"
      ? Math.max(0, now - status.startedAt)
      : 0;

  const send = (message: ContentToBackgroundMessage) => {
    void chrome.runtime.sendMessage(message).catch(() => undefined);
  };

  const finish = (message: ContentToBackgroundMessage) => {
    if (finishing) return;
    setFinishing(true);
    send(message);
  };

  return (
    <>
      <style>{CHIP_CSS}</style>
      <div style={styles.chip}>
        <div style={styles.recRow}>
          <span
            style={{
              ...styles.dot,
              background: paused ? "#A78BFA" : "#EF4444",
              animation: paused
                ? "none"
                : "capann-rec-pulse 1.6s ease-in-out infinite",
            }}
          />
          <span style={styles.time} aria-label="Elapsed recording time">
            {formatDuration(elapsedMs)}
          </span>
        </div>
        <div style={styles.divider} />
        <ChipButton
          label={paused ? "Resume recording" : "Pause recording"}
          onClick={() =>
            send(paused ? { kind: "record-resume" } : { kind: "record-pause" })
          }
          disabled={starting || finishing}
        >
          {paused ? (
            <PlayIcon size={18} weight="fill" />
          ) : (
            <PauseIcon size={18} weight="fill" />
          )}
        </ChipButton>
        <ChipButton
          label="Stop and save recording"
          onClick={() => finish({ kind: "record-stop" })}
          disabled={finishing}
          color="#86EFAC"
        >
          <StopIcon size={18} weight="fill" />
        </ChipButton>
        <ChipButton
          label="Discard recording"
          onClick={() => finish({ kind: "record-discard" })}
          disabled={finishing}
        >
          <TrashIcon size={18} weight="fill" />
        </ChipButton>
      </div>
      {hasFrame && (
        <div
          className="capann-camera-shell"
          style={{
            ...styles.cameraShell,
            width: CAMERA_BUBBLE_SIZES[cameraSize],
            height: CAMERA_BUBBLE_SIZES[cameraSize],
          }}
        >
          <div style={styles.cameraBubble}>
            <canvas
              ref={frameCanvasRef}
              width={480}
              height={270}
              role="img"
              aria-label="Camera preview"
              style={styles.cameraImage}
            />
          </div>
          <button
            type="button"
            className="capann-camera-resize"
            style={styles.cameraResize}
            onClick={() =>
              setCameraSize((size) => NEXT_CAMERA_BUBBLE_SIZE[size])
            }
            aria-label={`Camera size ${cameraSize}. Switch to ${nextCameraSize}.`}
            title={`Camera size ${cameraSize} — click for ${nextCameraSize}`}
          >
            <ArrowsOutSimpleIcon size={13} weight="bold" />
            <span>{cameraSize}</span>
          </button>
        </div>
      )}
    </>
  );
}
