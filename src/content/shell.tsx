/**
 * shell.tsx
 *
 * Shared Capann panel shell. Record and Annotate render as sibling views
 * inside this shell, so both share the same location, header, Back/Close
 * behavior, and drag-to-reposition.
 *
 * The drag position is CONTROLLED by the parent. Because each view mounts its
 * own `CapannShell`, internal position state would be discarded whenever the
 * user switches between the chooser, Annotate, and Record, snapping the panel
 * back to its docked corner. The parent holds one position for all three and
 * clears it when the panel closes.
 */

import { DotsSixIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

/** Panel fade-out duration; parents keep a closing panel mounted this long. */
export const PANEL_FADE_MS = 140;

/** How long the open-stagger class stays on (12 rows * 50ms + 180ms, rounded). */
const ENTER_WINDOW_MS = 800;

/** Explicit top/left once the panel has been dragged; null = docked top-right. */
export interface ShellPosition {
  top: number;
  left: number;
}

export const SHELL_BUTTON: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,.1)",
  borderRadius: "14px",
  padding: "12px 14px",
  background: "#26262B",
  color: "#F5F5F7",
  cursor: "pointer",
  font: "500 13px/1.2 Manrope, Inter, system-ui, sans-serif",
};

const HEADER_BUTTON: React.CSSProperties = {
  ...SHELL_BUTTON,
  padding: "6px 10px",
  color: "#8B8B93",
};

export interface CapannShellProps {
  title: string;
  subtitle?: string;
  /** Back returns to the chooser. Hidden while recording. */
  showBack: boolean;
  onBack: () => void;
  onClose: () => void;
  /** Mode-specific header controls, e.g. Annotate undo/redo. */
  actions?: ReactNode;
  /**
   * Controlled drag position. Owned by the parent because Annotate, Record,
   * and the chooser are three different shell instances: internal state here
   * would be thrown away on every view switch and snap the panel home.
   */
  position: ShellPosition | null;
  onPositionChange: (position: ShellPosition) => void;
  /** Fade the panel out (parent keeps it mounted until the fade finishes). */
  closing?: boolean;
  children: ReactNode;
}

interface DragState {
  startX: number;
  startY: number;
  origLeft: number;
  origTop: number;
}

export function CapannShell({
  title,
  subtitle,
  showBack,
  onBack,
  onClose,
  actions,
  position,
  onPositionChange,
  closing = false,
  children,
}: CapannShellProps) {
  const panelRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  // Stagger only applies right after mount, so rows that appear later (status
  // text, contextual options) are not delayed.
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setEntering(false), ENTER_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    // Buttons handle their own clicks; only the header background drags.
    if ((e.target as HTMLElement).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHeaderPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const left = Math.min(
      Math.max(0, drag.origLeft + e.clientX - drag.startX),
      Math.max(0, window.innerWidth - 120),
    );
    const top = Math.min(
      Math.max(0, drag.origTop + e.clientY - drag.startY),
      Math.max(0, window.innerHeight - 80),
    );
    onPositionChange({ top, left });
  };

  const onHeaderPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <section
      ref={panelRef}
      aria-label={`Capann ${title}`}
      style={{
        position: "fixed",
        top: position ? position.top : "48px",
        right: position ? undefined : "56px",
        left: position ? position.left : undefined,
        zIndex: 2147483647,
        boxSizing: "border-box",
        width: "min(280px, calc(100vw - 32px))",
        padding: "0 16px 16px 16px",
        borderRadius: "24px",
        background: "rgba(28,28,32,0.88)",
        color: "#F5F5F7",
        border: "1px solid rgba(255,255,255,0.1)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        font: "400 13px/1.45 Manrope, Inter, system-ui, sans-serif",
        boxShadow: "0 18px 52px rgba(0,0,0,.28)",
        animation: closing
          ? `panelOut ${PANEL_FADE_MS}ms cubic-bezier(0.2,0.8,0.2,1) both`
          : undefined,
        pointerEvents: closing ? "none" : undefined,
      }}
    >
      <header
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
        onPointerCancel={onHeaderPointerUp}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
          touchAction: "none",
        }}
      >
        <div style={{ width: "100%",   cursor: "grab", textAlign: "center" }}>
          <DotsSixIcon size={25} />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            width: "100%",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <img
              src={chrome.runtime.getURL("icons/capann-logo.png")}
              alt=""
              width="30"
              height="30"
              style={{ borderRadius: 8, pointerEvents: "none" }}
            />
            <strong style={{ fontSize: 15 }}>Capann</strong>
          </div>

          <div style={{ display: "flex", flexDirection: "row", gap: 8 }}>
            {showBack && (
              <button
                onClick={onBack}
                aria-label="Back to Capann choices"
                style={HEADER_BUTTON}
              >
                ‹
              </button>
            )}

            <button
              onClick={onClose}
              aria-label="Close Capann"
              style={HEADER_BUTTON}
            >
              ×
            </button>
          </div>
        </div>

        {/***
         * Title, optional subtitle, and mode-specific header actions (e.g.Annotate undo/redo).
         */}
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            width: "100%",
          }}
        >
          <div style={{ flex: 1, minWidth: 0, pointerEvents: "none" }}>
            {title.toLowerCase() !== "capann" && (
              <strong style={{ fontSize: 15 }}>{title}</strong>
            )}

            {subtitle && (
              <div style={{ color: "#8B8B93", fontSize: 11 }}>{subtitle}</div>
            )}
          </div>

          {actions}
        </div>
      </header>

      <div className={entering ? "capann-rows entering" : "capann-rows"}>
        {children}
      </div>

      <style>{`
        /* Every panel opens the same way: its rows stagger in (--stagger-row,
           50ms apart) for the first moments after mount. Rows that appear
           later (status text, option rows) are not delayed. */
        .capann-rows.entering > :not(:only-child),
        .capann-rows.entering > :only-child > * {
          animation: rowIn 180ms cubic-bezier(0.2,0.8,0.2,1) both;
        }
        .capann-rows.entering > :not(:only-child):nth-child(1),
        .capann-rows.entering > :only-child > :nth-child(1) { animation-delay: 0ms; }
        .capann-rows.entering > :not(:only-child):nth-child(2),
        .capann-rows.entering > :only-child > :nth-child(2) { animation-delay: 50ms; }
        .capann-rows.entering > :not(:only-child):nth-child(3),
        .capann-rows.entering > :only-child > :nth-child(3) { animation-delay: 100ms; }
        .capann-rows.entering > :not(:only-child):nth-child(4),
        .capann-rows.entering > :only-child > :nth-child(4) { animation-delay: 150ms; }
        .capann-rows.entering > :not(:only-child):nth-child(5),
        .capann-rows.entering > :only-child > :nth-child(5) { animation-delay: 200ms; }
        .capann-rows.entering > :not(:only-child):nth-child(6),
        .capann-rows.entering > :only-child > :nth-child(6) { animation-delay: 250ms; }
        .capann-rows.entering > :not(:only-child):nth-child(7),
        .capann-rows.entering > :only-child > :nth-child(7) { animation-delay: 300ms; }
        .capann-rows.entering > :not(:only-child):nth-child(8),
        .capann-rows.entering > :only-child > :nth-child(8) { animation-delay: 350ms; }
        .capann-rows.entering > :not(:only-child):nth-child(9),
        .capann-rows.entering > :only-child > :nth-child(9) { animation-delay: 400ms; }
        .capann-rows.entering > :not(:only-child):nth-child(10),
        .capann-rows.entering > :only-child > :nth-child(10) { animation-delay: 450ms; }
        .capann-rows.entering > :not(:only-child):nth-child(11),
        .capann-rows.entering > :only-child > :nth-child(11) { animation-delay: 500ms; }
        .capann-rows.entering > :not(:only-child):nth-child(12),
        .capann-rows.entering > :only-child > :nth-child(12) { animation-delay: 550ms; }
        @keyframes panelOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes rowIn {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }
        @keyframes pulseDot {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.35;
          }
        }
      `}</style>
    </section>
  );
}
